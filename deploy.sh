#!/bin/bash
set -e
echo "=== TrendLens AI v6.0 Docker Deployment ==="
echo ""

# Build and start all services
echo "Building and starting services..."
docker compose build
docker compose up -d

echo ""
echo "Waiting for MongoDB to be ready..."
sleep 10

# Seed the database
echo "Seeding database with sample data..."
docker compose run --rm seed

echo ""
echo "=== Deployment Complete ==="
echo "Frontend:     http://localhost:3000"
echo "Backend API:  http://localhost:8000"
echo "API Docs:     http://localhost:8000/docs"
echo "Mongo Express: http://localhost:8081"
echo ""
echo "To stop:  docker compose down"
