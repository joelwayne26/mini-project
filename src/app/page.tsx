/**
 * TrendLens AI v6.0 — Main Dashboard Page
 * Single-page application with 9 tabs covering all features.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { ScoreDisplay } from '@/components/shared/ScoreDisplay';
import { ShapWaterfallChart } from '@/components/charts/ShapWaterfallChart';
import { PosterEvaluation, TrendSignal, DashboardStats } from '@/lib/types';

// ─── Icons (inline SVG) ────────────────────────────────────────────────────

const Icons = {
  dashboard: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>,
  evaluate: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  trends: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  insights: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>,
  pipeline: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-8"/><path d="m5.3 10.3 1.8 1.8"/><path d="M2 8h2"/><path d="M20 8h2"/><path d="m17.7 10.3-1.8 1.8"/><path d="M22 14H2"/><path d="M22 2l-5 5"/><path d="M17 7l5-5"/></svg>,
  models: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/></svg>,
  settings: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>,
  guide: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  sparkles: <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>,
};

export default function TrendLensDashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [caption, setCaption] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<(PosterEvaluation & { imageQuality?: any; imageImprovements?: string[] }) | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [trends, setTrends] = useState<TrendSignal[]>([]);
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string>('');
  const [imageFileName, setImageFileName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch Stats ────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setStats(data);
    } catch {
      setStats({ totalEvaluations: 0, groundTruthCount: 0, modelAuc: 0, modelVersion: 'none', avgScore: 0, topCategory: 'general', dbConnected: false });
    }
  }, []);

  // ─── Fetch Trends ──────────────────────────────────────────────────
  const fetchTrends = useCallback(async (category = 'general') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trends?category=${category}&limit=15`);
      const data = await res.json();
      setTrends(data.trends || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  // ─── Handle Image Upload (with client-side resize for Vercel) ──────
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('Image too large. Max 10MB.');
      return;
    }
    setImageFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setImagePreview(result);
      // Resize image client-side to keep base64 under Vercel's 4.5MB body limit
      resizeImageForVercel(result).then(resized => {
        setImageBase64(resized);
      });
    };
    reader.readAsDataURL(file);
  };

  /** Resize image to max 1200px wide, JPEG quality 0.7 — keeps base64 under ~1.5MB */
  const resizeImageForVercel = (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1200;
        let w = img.width, h = img.height;
        if (w > MAX_W) { h = Math.round(h * (MAX_W / w)); w = MAX_W; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(dataUrl); // fallback: send original
      img.src = dataUrl;
    });
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageBase64('');
    setImageFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ─── Evaluate ──────────────────────────────────────────────────────
  const handleEvaluate = async () => {
    if (!caption.trim() && !imageBase64) return;
    setEvaluating(true);
    try {
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption || '(No caption provided)',
          imageBase64: imageBase64 || undefined,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
        alert('Evaluation failed: ' + (errData.error || errData.detail || res.statusText));
        setEvaluating(false);
        return;
      }
      const data = await res.json();
      setEvaluation(data);
    } catch (error) {
      console.error('Evaluation failed:', error);
      alert('Could not reach the server. The image may be too large, or the server timed out. Try a smaller image.');
    }
    setEvaluating(false);
  };

  // ─── Feedback ──────────────────────────────────────────────────────
  const submitFeedback = async (type: string, rating: 'thumbs_up' | 'thumbs_down') => {
    if (!evaluation) return;
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ evaluationId: evaluation.evaluatedAt, type, rating }),
      });
    } catch { /* ignore */ }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">TL</span>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">TrendLens AI</h1>
              <p className="text-xs text-muted-foreground">Social Media Analytics for Ugandan Food Businesses</p>
            </div>
          </div>
          <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50">
            v6.0 — AI Co-pilot
          </Badge>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <TabsList className="flex flex-wrap gap-1 bg-muted/50 p-1 rounded-lg">
            <TabsTrigger value="dashboard" className="gap-1.5 text-xs">{Icons.dashboard} Dashboard</TabsTrigger>
            <TabsTrigger value="evaluate" className="gap-1.5 text-xs">{Icons.evaluate} Evaluate</TabsTrigger>
            <TabsTrigger value="trends" className="gap-1.5 text-xs">{Icons.trends} Trends</TabsTrigger>
            <TabsTrigger value="insights" className="gap-1.5 text-xs">{Icons.insights} Insights</TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-1.5 text-xs">{Icons.pipeline} Pipeline</TabsTrigger>
            <TabsTrigger value="models" className="gap-1.5 text-xs">{Icons.models} Models</TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5 text-xs">{Icons.settings} Settings</TabsTrigger>
            <TabsTrigger value="guide" className="gap-1.5 text-xs">{Icons.guide} Guide</TabsTrigger>
          </TabsList>

          {/* ─── Dashboard Tab ──────────────────────────────────────── */}
          <TabsContent value="dashboard">
            <DashboardTab stats={stats} fetchStats={fetchStats} />
          </TabsContent>

          {/* ─── Evaluate Tab ────────────────────────────────────────── */}
          <TabsContent value="evaluate">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Input */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">{Icons.evaluate} Evaluate Poster</CardTitle>
                  <CardDescription>Enter your caption to get an AI-powered evaluation with SHAP explanations and RAG insights</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Enter your social media caption here... e.g., 'Fresh cakes available! DM to order your custom wedding cake. #CakeKampala #UgandanBakery'"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    className="min-h-[120px]"
                  />

                  {/* Poster Image Upload */}
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                    {imagePreview ? (
                      <div className="relative rounded-lg overflow-hidden border bg-muted/30">
                        <img
                          src={imagePreview}
                          alt="Poster preview"
                          className="w-full max-h-[200px] object-contain"
                        />
                        <button
                          onClick={clearImage}
                          className="absolute top-2 right-2 bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-black/80"
                        >
                          x
                        </button>
                        <div className="absolute bottom-2 left-2 bg-black/60 text-white rounded px-2 py-0.5 text-[10px]">
                          {imageFileName}
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-full border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-950/20 transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2 text-muted-foreground"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                        <p className="text-sm text-muted-foreground">Upload poster image (optional)</p>
                        <p className="text-xs text-muted-foreground/70">Click or drag to upload. Max 10MB.</p>
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={handleEvaluate} disabled={evaluating || (!caption.trim() && !imageBase64)} className="bg-emerald-600 hover:bg-emerald-700">
                      {evaluating ? 'Evaluating...' : 'Evaluate Poster'}
                    </Button>
                    <Button variant="outline" onClick={() => { setCaption(''); setEvaluation(null); clearImage(); }}>
                      Clear
                    </Button>
                  </div>
                  {(caption || imageBase64) && !evaluation && (
                    <div className="text-sm text-muted-foreground">
                      {caption.split(/\s+/).filter(Boolean).length} words | {(caption.match(/#\w+/g) || []).length} hashtags | {(caption.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}]/gu) || []).length} emojis{imageBase64 ? ' | Image attached' : ''}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Results */}
              <div className="space-y-4">
                {evaluation ? (
                  <>
                    {/* Score Summary */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Score Summary</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-3 gap-3">
                          <ScoreDisplay score={evaluation.overallScore} label="Overall" size="lg" />
                          <ScoreDisplay score={evaluation.posterScore} label="Poster" />
                          <ScoreDisplay score={evaluation.captionScore} label="Caption" />
                        </div>
                        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
                          <span>Confidence: {(evaluation.confidenceInterval?.lower ?? 0).toFixed(1)} - {(evaluation.confidenceInterval?.upper ?? 0).toFixed(1)}</span>
                          <Badge variant="outline" className="text-xs">
                            {evaluation.dataSource === 'mongodb' ? 'Data-driven' : 'Heuristic'}
                          </Badge>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => submitFeedback('score', 'thumbs_up')}>👍 Helpful</Button>
                          <Button size="sm" variant="outline" onClick={() => submitFeedback('score', 'thumbs_down')}>👎 Not helpful</Button>
                        </div>
                        {/* Contextual Insight */}
                        {evaluation.captionInsight && (
                          <div className="mt-3 p-3 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 rounded-lg">
                            <p className="text-xs font-semibold text-sky-700 dark:text-sky-400 mb-1">Contextual Insight</p>
                            <p className="text-sm text-sky-900 dark:text-sky-100">{evaluation.captionInsight}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* SHAP Waterfall */}
                    {evaluation.shapValues && evaluation.shapValues.length > 0 && (
                      <Card>
                        <CardHeader>
                          <CardTitle className="text-base flex items-center gap-2">{Icons.sparkles} Score Explanation</CardTitle>
                          <CardDescription>See what drives your score — green features increase it, red features decrease it</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <ShapWaterfallChart shapValues={evaluation.shapValues} />
                        </CardContent>
                      </Card>
                    )}

                    {/* Caption Insight */}
                    {(evaluation as any).captionInsight && (
                      <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">{Icons.insights} Caption Insight</CardTitle>
                          <CardDescription>Contextual semantic analysis of your caption</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground">{(evaluation as any).captionInsight}</p>
                        </CardContent>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card className="flex items-center justify-center min-h-[200px]">
                    <div className="text-center text-muted-foreground">
                      <p className="text-lg font-medium">No evaluation yet</p>
                      <p className="text-sm">Enter a caption and click Evaluate to get started</p>
                    </div>
                  </Card>
                )}
              </div>
            </div>

            {/* Detailed Results Below */}
            {evaluation && (
              <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* AI-Generated Caption */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">{Icons.sparkles} AI-Generated Caption</CardTitle>
                    <CardDescription>Contextually-aware caption crafted for maximum engagement</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-4 border border-emerald-200 dark:border-emerald-800">
                      <p className="text-sm whitespace-pre-wrap">{evaluation.improvedCaption}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => submitFeedback('caption', 'thumbs_up')}>👍 Better</Button>
                      <Button size="sm" variant="outline" onClick={() => submitFeedback('caption', 'thumbs_down')}>👎 Worse</Button>
                    </div>

                    {/* Platform Variants */}
                    {evaluation.captionVariants && evaluation.captionVariants.length > 0 && (
                      <div className="space-y-2 mt-3">
                        <h4 className="text-sm font-semibold">Platform Variants</h4>
                        {evaluation.captionVariants.map((variant, idx) => (
                          <div key={idx} className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-between mb-1">
                              <Badge variant="secondary" className="text-xs capitalize">{variant.platform}</Badge>
                              <span className="text-xs text-muted-foreground">Predicted: {variant.scorePrediction.toFixed(1)}/10</span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{variant.reasoning}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Improvements */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Improvement Suggestions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {evaluation.captionImprovements.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Caption Improvements</h4>
                        <ul className="space-y-1.5">
                          {evaluation.captionImprovements.map((imp, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{imp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {evaluation.posterImprovements.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">Poster Improvements</h4>
                        <ul className="space-y-1.5">
                          {evaluation.posterImprovements.map((imp, idx) => (
                            <li key={idx} className="text-sm text-muted-foreground flex gap-2">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{imp}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Image Quality Analysis */}
                {evaluation.imageQuality && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Image Quality Analysis</CardTitle>
                      <CardDescription>Server-side analysis of your poster image using Sharp</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="text-center">
                          <p className="text-lg font-bold">{(evaluation.imageQuality.brightness * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Brightness</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">{(evaluation.imageQuality.contrast * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Contrast</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">{(evaluation.imageQuality.saturation * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Saturation</p>
                        </div>
                        <div className="text-center">
                          <p className="text-lg font-bold">{(evaluation.imageQuality.blurScore * 100).toFixed(0)}%</p>
                          <p className="text-xs text-muted-foreground">Sharpness</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="text-sm">
                          Resolution: {evaluation.imageQuality.resolution?.width || 0}x{evaluation.imageQuality.resolution?.height || 0}
                        </div>
                        <Badge variant={evaluation.imageQuality.qualityRating === 'excellent' ? 'default' : evaluation.imageQuality.qualityRating === 'good' ? 'secondary' : evaluation.imageQuality.qualityRating === 'fair' ? 'outline' : 'destructive'} className="text-xs capitalize">
                          {evaluation.imageQuality.qualityRating} quality
                        </Badge>
                      </div>
                      {evaluation.imageImprovements && evaluation.imageImprovements.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold">Image Improvements:</p>
                          {evaluation.imageImprovements.map((imp: string, idx: number) => (
                            <p key={idx} className="text-xs text-muted-foreground flex gap-1.5">
                              <span className="text-blue-500">•</span> {imp}
                            </p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* RAG Insights */}
                {evaluation.ragInsights && evaluation.ragInsights.length > 0 && (
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">{Icons.insights} RAG-Powered Insights</CardTitle>
                      <CardDescription>Similar high-performing posts from our database — learn from what works</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {evaluation.ragInsights.map((insight, idx) => (
                          <div key={idx} className="bg-muted/50 rounded-lg p-3 border">
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="secondary" className="text-xs">{insight.category}</Badge>
                              <span className="text-xs font-medium text-emerald-600">
                                {Math.round(insight.engagementRate * 100)}% engagement
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-3 mb-2">{insight.caption}</p>
                            {insight.keyPatterns.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {insight.keyPatterns.map((p, i) => (
                                  <Badge key={i} variant="outline" className="text-[10px]">{p}</Badge>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">{insight.takeaway}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Benchmarks */}
                {evaluation.benchmarks && evaluation.benchmarks.dbConnected && (
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base">Data Benchmarks</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="text-center">
                          <p className="text-2xl font-bold">{evaluation.benchmarks.categorySamples}</p>
                          <p className="text-xs text-muted-foreground">Category Samples</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold">{(evaluation.benchmarks.industryAvgEngagement * 100).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">Avg Engagement</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold">{(evaluation.benchmarks.ctaEngagementBoost * 100).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">CTA Boost</p>
                        </div>
                        <div className="text-center">
                          <p className="text-2xl font-bold">{(evaluation.benchmarks.priceEngagementBoost * 100).toFixed(1)}%</p>
                          <p className="text-xs text-muted-foreground">Price Boost</p>
                        </div>
                      </div>
                      {evaluation.benchmarks.topHashtags && evaluation.benchmarks.topHashtags.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs text-muted-foreground mb-1">Top Performing Hashtags:</p>
                          <div className="flex flex-wrap gap-1">
                            {evaluation.benchmarks.topHashtags.map((tag, idx) => (
                              <Badge key={idx} variant="outline" className="text-xs">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </TabsContent>

          {/* ─── Trends Tab ──────────────────────────────────────────── */}
          <TabsContent value="trends">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{Icons.trends} Trending Topics</CardTitle>
                <CardDescription>Current food business trends in Uganda</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  {['general', 'cake', 'bakery', 'restaurant'].map(cat => (
                    <Button key={cat} variant="outline" size="sm" onClick={() => fetchTrends(cat)} className="capitalize">
                      {cat}
                    </Button>
                  ))}
                </div>
                {trends.length > 0 ? (
                  <div className="space-y-2">
                    {trends.map((trend, idx) => (
                      <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-bold text-muted-foreground w-6">{idx + 1}.</span>
                          <div>
                            <p className="text-sm font-medium capitalize">{trend.keyword}</p>
                            <p className="text-xs text-muted-foreground">{trend.volume.toLocaleString()} searches</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant="secondary" className="text-xs">
                            {(trend.growthRate * 100).toFixed(0)}% growth
                          </Badge>
                          <div className="w-16 bg-muted rounded-full h-2">
                            <div
                              className="h-full bg-emerald-500 rounded-full"
                              style={{ width: `${trend.score * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Click a category above to see trends</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Insights Tab ────────────────────────────────────────── */}
          <TabsContent value="insights">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{Icons.insights} RAG Insights</CardTitle>
                <CardDescription>Search for similar high-performing posts using AI-powered similarity matching</CardDescription>
              </CardHeader>
              <CardContent>
                <RagSearchPanel />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Pipeline Tab ────────────────────────────────────────── */}
          <TabsContent value="pipeline">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">{Icons.pipeline} Data Pipeline</CardTitle>
                  <CardDescription>ETL transformation and auto-retraining pipeline</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <PipelineStatusDisplay />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>MMD Drift Detection</CardTitle>
                  <CardDescription>Statistical drift monitoring using Maximum Mean Discrepancy</CardDescription>
                </CardHeader>
                <CardContent>
                  <DriftDisplay />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Models Tab ──────────────────────────────────────────── */}
          <TabsContent value="models">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{Icons.models} Model Registry</CardTitle>
                <CardDescription>XGBoost model version history and performance metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <ModelsDisplay />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Settings Tab ────────────────────────────────────────── */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{Icons.settings} Settings</CardTitle>
                <CardDescription>Configuration and feature flags</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <SettingsDisplay />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Guide Tab ───────────────────────────────────────────── */}
          <TabsContent value="guide">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">{Icons.guide} User Guide</CardTitle>
                <CardDescription>How to use TrendLens AI v6.0 effectively</CardDescription>
              </CardHeader>
              <CardContent>
                <GuideContent />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="border-t py-4 mt-8">
        <div className="container mx-auto px-4 text-center text-xs text-muted-foreground">
          TrendLens AI v6.0 — AI Co-pilot for Ugandan Food Businesses | No external LLM APIs | RAG + SHAP + Local Caption Generation
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function DashboardTab({ stats, fetchStats }: { stats: DashboardStats | null; fetchStats: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System Overview</h2>
        <Button variant="outline" size="sm" onClick={fetchStats}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats?.totalEvaluations || 0}</p>
            <p className="text-xs text-muted-foreground">Total Evaluations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats?.groundTruthCount || 0}</p>
            <p className="text-xs text-muted-foreground">Ground Truth Samples</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{stats?.avgScore?.toFixed(1) || '0.0'}</p>
            <p className="text-xs text-muted-foreground">Avg Score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Badge variant={stats?.dbConnected ? 'default' : 'destructive'} className="text-xs">
              {stats?.dbConnected ? 'MongoDB Connected' : 'DB Disconnected'}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">Model: {stats?.modelVersion || 'none'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Feature Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              {Icons.sparkles}
              <h3 className="font-semibold">Local AI Caption Generator</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Generate creative, engagement-optimized captions without any external LLM APIs. Template-based NLG with domain knowledge.
            </p>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-950/20 dark:border-amber-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              {Icons.insights}
              <h3 className="font-semibold">RAG-Powered Insights</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Find similar high-performing posts using MongoDB Atlas Vector Search. Data-grounded recommendations from real Ugandan food business data.
            </p>
          </CardContent>
        </Card>
        <Card className="border-violet-200 bg-violet-50/50 dark:bg-violet-950/20 dark:border-violet-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              {Icons.models}
              <h3 className="font-semibold">SHAP Explainability</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Understand why you got your score with SHAP feature contributions. See exactly what drives your score up or down.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RagSearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/rag/search?caption=${encodeURIComponent(query)}&category=general&limit=5`);
      const data = await res.json();
      setResults(data.insights || []);
    } catch { /* ignore */ }
    setSearching(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search for similar high-performing posts..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button onClick={handleSearch} disabled={searching} className="bg-emerald-600 hover:bg-emerald-700">
          {searching ? 'Searching...' : 'Search'}
        </Button>
      </div>
      {results.length > 0 ? (
        <div className="space-y-3">
          {results.map((insight: Record<string, unknown>, idx: number) => (
            <div key={idx} className="bg-muted/50 rounded-lg p-4 border">
              <div className="flex items-center justify-between mb-2">
                <Badge variant="secondary" className="text-xs">{String(insight.category || '')}</Badge>
                <span className="text-sm font-medium text-emerald-600">
                  {Math.round(Number(insight.engagementRate || 0) * 100)}% engagement
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{String(insight.caption || '')}</p>
              <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-2">{String(insight.takeaway || '')}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Enter a caption to find similar high-performing posts from the database</p>
      )}
    </div>
  );
}

function PipelineStatusDisplay() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="w-3 h-3 rounded-full bg-emerald-500" />
        <div>
          <p className="text-sm font-medium">Data Transformation</p>
          <p className="text-xs text-muted-foreground">ETL pipeline: Ingest → Normalize → Enrich → Cluster → Ground Truth</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="w-3 h-3 rounded-full bg-amber-500" />
        <div>
          <p className="text-sm font-medium">Auto-Retraining</p>
          <p className="text-xs text-muted-foreground">XGBoost with StratifiedKFold CV + Ablation Study. Triggered by drift, volume, or schedule.</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="w-3 h-3 rounded-full bg-violet-500" />
        <div>
          <p className="text-sm font-medium">Drift Detection</p>
          <p className="text-xs text-muted-foreground">MMD with RBF kernel + permutation test (200 permutations). P-value significance threshold: 0.05</p>
        </div>
      </div>
      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
        <div className="w-3 h-3 rounded-full bg-blue-500" />
        <div>
          <p className="text-sm font-medium">Vector Embedding</p>
          <p className="text-xs text-muted-foreground">SBERT-compatible embeddings stored in MongoDB Atlas Vector Search for RAG retrieval</p>
        </div>
      </div>
    </div>
  );
}

function DriftDisplay() {
  const [measurements, setMeasurements] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const fetchDrift = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/pipeline/drift');
      const data = await res.json();
      setMeasurements(data.measurements || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={fetchDrift} disabled={loading}>
        {loading ? 'Loading...' : 'Load Drift Data'}
      </Button>
      {measurements.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {measurements.slice(0, 10).map((m: Record<string, unknown>, idx: number) => (
            <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded text-sm">
              <span className="text-xs text-muted-foreground">{String(m.timestamp || '').slice(0, 10)}</span>
              <span>MMD: {Number(m.mmd_score || 0).toFixed(4)}</span>
              <Badge variant={m.is_drift ? 'destructive' : 'secondary'} className="text-xs">
                {m.is_drift ? 'Drift!' : 'Stable'}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No drift measurements available. Connect MongoDB to enable drift detection.</p>
      )}
    </div>
  );
}

function ModelsDisplay() {
  const [versions, setVersions] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      setVersions(data.versions || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" onClick={fetchModels} disabled={loading}>
        {loading ? 'Loading...' : 'Load Model History'}
      </Button>
      {versions.length > 0 ? (
        <div className="space-y-2">
          {versions.map((v: Record<string, unknown>, idx: number) => (
            <div key={idx} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm font-medium">{String(v.version || 'unknown')}</p>
                <p className="text-xs text-muted-foreground">{String(v.trained_at || '').slice(0, 10)} | {Number(v.samples || 0)} samples</p>
              </div>
              <Badge variant="secondary" className="text-xs">
                AUC: {Number(v.auc || 0).toFixed(4)}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No trained models yet. Run the pipeline to train XGBoost.</p>
      )}
    </div>
  );
}

function SettingsDisplay() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2">Feature Flags</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">RAG-Powered Insights</span>
            <Badge variant="default" className="bg-emerald-600 text-xs">Enabled</Badge>
          </div>
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">SHAP Explainability</span>
            <Badge variant="default" className="bg-emerald-600 text-xs">Enabled</Badge>
          </div>
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">Local Caption Generation</span>
            <Badge variant="default" className="bg-emerald-600 text-xs">Enabled</Badge>
          </div>
          <div className="flex items-center justify-between p-2 bg-muted/50 rounded">
            <span className="text-sm">MMD Drift Detection</span>
            <Badge variant="default" className="bg-emerald-600 text-xs">Enabled</Badge>
          </div>
        </div>
      </div>
      <Separator />
      <div>
        <h3 className="text-sm font-semibold mb-2">Environment</h3>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>MONGO_URI: {process.env.NODE_ENV === 'development' ? 'Configure via .env' : 'Set via Vercel env vars'}</p>
          <p>Model: XGBoost (heuristic fallback when no trained model)</p>
          <p>Embeddings: TF-based 384-dim (upgrade to SBERT in production)</p>
          <p>Vector Search: MongoDB Atlas Vector Search</p>
        </div>
      </div>
    </div>
  );
}

function GuideContent() {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold mb-2">Getting Started</h3>
        <p className="text-sm text-muted-foreground">
          TrendLens AI v6.0 is an AI co-pilot for Ugandan food businesses on social media. Enter your caption
          in the Evaluate tab to get a comprehensive analysis including scores, SHAP explanations, RAG-powered
          insights from similar successful posts, and AI-generated caption improvements.
        </p>
      </section>
      <section>
        <h3 className="text-base font-semibold mb-2">What&apos;s New in v6.0</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>Local AI Caption Generator</strong> — Creative, engagement-optimized captions without any external LLM APIs. Uses template-based NLG with deep domain knowledge for Ugandan food businesses.</span></li>
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>RAG-Powered Insights</strong> — Find similar high-performing posts using MongoDB Atlas Vector Search. Get data-grounded recommendations from real successful posts.</span></li>
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>SHAP Explainability</strong> — See exactly what drives your score with feature contribution waterfall charts. No more mystery scores.</span></li>
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>Image Quality Assessment</strong> — Blur detection, brightness, contrast, and saturation analysis for your poster images.</span></li>
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>Vercel-Ready Deployment</strong> — Serverless architecture with MongoDB Atlas free tier. Zero cost, zero config.</span></li>
          <li className="flex gap-2"><span className="text-emerald-500">✓</span> <span><strong>User Feedback Loop</strong> — Rate suggestions to improve the system over time.</span></li>
        </ul>
      </section>
      <section>
        <h3 className="text-base font-semibold mb-2">How Scores Work</h3>
        <p className="text-sm text-muted-foreground">
          Scores range from 1-10 and are computed using a hybrid heuristic + data-driven approach. When MongoDB
          is connected, scores are adjusted based on real engagement data from similar posts. The SHAP waterfall
          chart shows exactly which features increase or decrease your score, so you know exactly what to improve.
        </p>
      </section>
      <section>
        <h3 className="text-base font-semibold mb-2">No External APIs</h3>
        <p className="text-sm text-muted-foreground">
          All AI features run locally — no LLM APIs, no paid services. Caption generation uses intelligent template-based
          NLG with domain patterns. RAG uses MongoDB Atlas Vector Search (free M0 tier). SHAP values are computed
          using a simplified algorithmic approach. Everything works on Vercel&apos;s free tier.
        </p>
      </section>
    </div>
  );
}
