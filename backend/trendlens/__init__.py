"""TrendLens AI v5.1 — Ugandan social-media poster evaluation & optimization.

Modules:
  - data_transformation_pipeline: Raw → clustered data ETL (field mapping)
  - auto_retraining_pipeline: MMD drift detection + auto-retrain
  - data_change_watcher: Auto-trigger pipeline when new data arrives
  - simulation: End-to-end improvement simulation
  - pipeline_api: REST endpoints for pipeline control
"""

__version__ = "5.2.0"
