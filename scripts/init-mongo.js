// MongoDB init script for Docker entrypoint
// Creates the trendlens database and application user
db = db.getSiblingDB('trendlens');

db.createCollection('posts');
db.createCollection('ground_truth_posts');
db.createCollection('embeddings');
db.createCollection('model_registry');
db.createCollection('drift_state');
db.createCollection('trend_snapshots');
db.createCollection('evaluations');
db.createCollection('user_feedback');
db.createCollection('system_activity_log');

// Create indexes
db.posts.createIndex({ category: 1, engagement_rate: -1 });
db.ground_truth_posts.createIndex({ category: 1, label: 1 });
db.ground_truth_posts.createIndex({ engagement_rate: -1 });
db.embeddings.createIndex({ category: 1 });
db.model_registry.createIndex({ model_type: 1, trained_at: -1 });
db.drift_state.createIndex({ timestamp: -1 });
db.trend_snapshots.createIndex({ category: 1, fetched_at: -1 });
db.evaluations.createIndex({ evaluated_at: -1 });
db.evaluations.createIndex({ category: 1 });
db.user_feedback.createIndex({ type: 1 });
db.system_activity_log.createIndex({ event_type: 1, created_at: -1 });

print('TrendLens AI v6.0 — MongoDB initialized with collections and indexes');
