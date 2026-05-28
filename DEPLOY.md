# TrendLens AI v6.0 — Deployment Guide

## Quick Start

### Option 1: Docker Compose (Recommended for production)

```bash
# Clone and navigate to the project
cd trendlens-ai

# Start all services (app + MongoDB + Mongo Express)
npm run docker:build
npm run docker:up

# Seed the database with sample data
npm run docker:seed

# Access the app at http://localhost:3000
# MongoDB Admin UI at http://localhost:8081
```

### Option 2: Vercel (Free tier)

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → New Project → Import repo
3. Set environment variables:
   - `MONGO_URI` = your MongoDB Atlas connection string
   - `MONGO_DB_NAME` = `trendlens`
4. Deploy — Vercel handles the rest (free tier: 100GB bandwidth, serverless functions)
5. After deploy, seed MongoDB using: `MONGO_URI="your-atlas-uri" npm run seed:clean`

### Option 3: Local Development

```bash
# Install dependencies
npm install

# Set up .env with your MongoDB URI
cp .env.example .env
# Edit .env to set MONGO_URI

# Seed the database
npm run seed

# Start dev server
npm run dev
# → http://localhost:3000
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | Yes | - | MongoDB connection string |
| `MONGO_DB_NAME` | No | `trendlens` | Database name |
| `MONGO_MAX_POOL_SIZE` | No | `10` | Connection pool max |
| `MONGO_MIN_POOL_SIZE` | No | `2` | Connection pool min |
| `RAG_ENABLED` | No | `true` | Enable RAG-powered insights |
| `SHAP_ENABLED` | No | `true` | Enable SHAP explainability |
| `CAPTION_GEN_ENABLED` | No | `true` | Enable local caption generation |

## MongoDB Atlas Setup (Free Tier)

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a database user
3. Whitelist your IP (or 0.0.0.0/0 for Vercel)
4. Get connection string → use as `MONGO_URI`
5. Create a Vector Search index:
   - Index name: `vector_index`
   - Collection: `embeddings`
   - Type: `vectorSearch`
   - Field: `embedding` (384 dimensions, cosine similarity)

## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `app` | 3000 | TrendLens AI Next.js app |
| `mongodb` | 27017 | MongoDB 7.0 database |
| `mongo-express` | 8081 | MongoDB admin UI |
| `seed` | - | One-time database seeder |

## Key Features

- **No external LLM APIs** — all AI is local (heuristic + template-based NLG)
- **MongoDB Atlas Vector Search** — RAG-powered insights from real data
- **SHAP Explainability** — understand why you got your score
- **Sharp Image Analysis** — server-side poster quality assessment
- **Vercel-compatible** — serverless, no temp files, no paid services
- **Docker-ready** — one-command deployment with docker compose

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate` | Full poster evaluation with SHAP + RAG |
| POST | `/api/upload` | Image upload & Sharp quality analysis |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/trends` | Trending topics by category |
| GET | `/api/rag/search` | Vector similarity search |
| POST | `/api/feedback` | User feedback collection |
| GET | `/api/models` | Model version history |
| GET | `/api/pipeline/drift` | Drift measurements |
| GET | `/api/health` | System health check |
