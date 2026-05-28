# TrendLens AI v6.0 — Docker Deployment

Social media trend analytics platform for Ugandan food businesses.

## Quick Start

```bash
chmod +x deploy.sh
./deploy.sh
```

## Access Points

- **Frontend Dashboard**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs
- **Mongo Express**: http://localhost:8081

## Architecture

```
trendlens-ai-v6/
├── backend/              # Python FastAPI
│   ├── main.py           # FastAPI app with all endpoints
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── scripts/          # Database seed scripts
│   │   └── seed_mongodb.py
│   └── trendlens/        # Core ML pipeline modules
│       ├── config.py
│       ├── database.py   # MongoDB connection + 10 repositories
│       ├── models.py
│       ├── monitoring.py
│       ├── ocr_engine.py
│       ├── phase1_trend_engine.py
│       ├── phase5_caption_intelligence.py
│       ├── phase7_evaluator.py
│       ├── shap_explainer.py       # NEW: SHAP feature contributions
│       ├── rag_engine.py           # NEW: RAG-powered similar posts
│       ├── caption_generator.py    # NEW: Template-based NLG
│       ├── image_quality.py        # NEW: Pillow image analysis
│       ├── processors.py
│       ├── text_processor.py
│       ├── data_transformation_pipeline.py
│       ├── auto_retraining_pipeline.py
│       ├── simulation.py
│       ├── pipeline_api.py
│       ├── poster_annotations.py
│       ├── competitor_intelligence.py
│       ├── data_change_watcher.py
│       └── trend_sources/  # Trend data sources
├── frontend/             # Next.js Dashboard
│   ├── src/app/          # Pages
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── .env.docker
└── deploy.sh
```

## What's New in v6.0

- **SHAP Explainability**: See which features contribute positively/negatively to your score
- **RAG-Powered Insights**: Find similar high-performing posts from your MongoDB data
- **Image Quality Analysis**: Get brightness, contrast, saturation, and sharpness metrics
- **Template-Based Caption Generation**: Improved captions without external LLM APIs
- **Enhanced MongoDB Integration**: Full vector search support with Atlas Vector Search
- **Feedback System**: Thumbs up/down on evaluations with aggregate stats
- **Drift Measurements**: Dedicated drift measurement endpoint
- **Docker with MongoDB**: Full Docker Compose with MongoDB 7.0 and Mongo Express

## Environment Variables

Copy `.env.docker` to `.env` and update as needed:

- `MONGO_URI`: MongoDB connection string
- `MONGO_DB_NAME`: Database name (default: trendlens)
- `NEXT_PUBLIC_API_URL`: Backend URL (default: http://localhost:8000)

## API Endpoints

- `GET /health` — System health check
- `GET /stats` — Quick dashboard statistics
- `POST /evaluate/poster` — Full poster evaluation with SHAP + RAG + image quality
- `GET /evaluate/poster` — Legacy evaluation (query params)
- `GET /trends/current` — Current trends
- `GET /benchmark/{category}` — Category benchmarks
- `POST /feedback` — Submit feedback
- `GET /feedback/stats` — Feedback statistics
- `GET /drift/measurements` — Drift measurements
- `GET /models/history` — Model version history
- `GET /activity` — Recent system activity
- Plus all pipeline endpoints under `/pipeline/*`

## Dashboard Pages

1. **Dashboard** — System health, model status, quick stats, activity feed
2. **Evaluate** — Upload poster + caption for 1-10 score with SHAP & RAG insights
3. **Pipeline** — Transform, drift detection, retraining controls
4. **Watcher** — Background data change detection
5. **Field Map** — Raw→clustered field mapping
6. **Drift** — MMD drift measurements over time
7. **Retrain** — Check triggers + Run auto-retrain
8. **Trends** — Current trending terms by category
9. **Simulation** — End-to-end simulation with drift injection
10. **Models** — Version tracking with AUC trend chart
11. **Worker** — Background retraining worker
12. **Settings** — Connection info and MongoDB collections
13. **Guide** — User guide

## Key Principles

- **No external LLM APIs** — all AI is local (heuristic, template-based NLG, TF-IDF similarity)
- **MongoDB Atlas Vector Search** — RAG-powered insights from real data
- **SHAP Explainability** — understand why you got your score
- **Sharp Image Analysis** — server-side poster quality assessment
- **Vercel-compatible** — serverless, no temp files, no paid services
- **Docker-ready** — one-command deployment with docker compose
