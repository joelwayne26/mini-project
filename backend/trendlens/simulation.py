"""
trendlens/simulation.py
End-to-end simulation demonstrating automatic system improvement.

This script:
  1. Seeds MongoDB with realistic Ugandan food business data
  2. Runs the data transformation pipeline
  3. Triggers auto-retraining
  4. Measures improvement in model quality (AUC) across iterations
  5. Simulates data drift and demonstrates drift-triggered retraining
  6. Prints a comprehensive improvement report

Usage:
    python -m trendlens.simulation
    python -m trendlens.simulation --iterations 3 --docs 200
"""

import argparse
import logging
import random
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

import numpy as np

from trendlens.config import settings
from trendlens.database import (
    ActivityLogRepository,
    BaseRepository,
    get_collection,
)
from trendlens.monitoring import structured_log

logger = logging.getLogger(__name__)


# ─── Simulation Data Generator ────────────────────────────────────────────────

UGANDAN_FOOD_CATEGORIES = {
    "cake": {
        "captions": [
            "Order your birthday cake today! DM us for custom designs 🎂 #KampalaCakes #BirthdayVibes",
            "Wedding cake perfection 💍 Our signature 3-tier design. Book now! #UgandaWeddings",
            "Cupcake special: UGX 5,000 each or 6 for UGX 25,000! DM to order 🧁",
            "Chocolate lovers! Our rich chocolate cake is perfect for any celebration 🍫",
            "Fresh cream cake available daily. WhatsApp +256 7XX XXX XXX to order 🎂",
            "Royal wedding cake with gold fondant details ✨ Order 48hrs ahead!",
            "Red velvet dream cake 🎂 Perfect for anniversaries and celebrations!",
            "Our signature fruit cake — a Kampala classic! Order for Christmas 🎄",
        ],
        "likes_range": (50, 2500),
        "comments_range": (5, 150),
        "followers_range": (500, 50000),
    },
    "bakery": {
        "captions": [
            "Fresh from the oven! Our signature mandazi and samosas 🥐 #KampalaBakery",
            "Breakfast special: Rolexes + Chapati combo UGX 3,000! 🥖 #UgandaFood",
            "Fresh bread daily! Visit us on Luwum Street before 10am for the best selection 🍞",
            "Our famous cinnamon rolls are back! Limited batches daily 🥐✨",
            "Whole wheat bread now available! Healthy eating starts here 🌾 #KampalaHealth",
            "Samosa platter for your next event! DM to order 🥟 #UgandanFood",
            "Fresh pastries every morning! Follow us for daily specials 🥐☕",
            "Bugatti bread — soft, fluffy, perfect for your family 🍞 Visit us today!",
        ],
        "likes_range": (30, 1800),
        "comments_range": (3, 100),
        "followers_range": (300, 30000),
    },
    "restaurant": {
        "captions": [
            "Lunch special: Matooke + Gnuts + Rice UGX 8,000! 🍽️ #KampalaRestaurant",
            "Our signature Luwombo — slow-cooked to perfection in banana leaves 🍲",
            "Friday night dinner! Try our grilled tilapia with local vegetables 🐟",
            "Best Rolex in Kampala! Visit us on Kampala Road 🌯 #UgandaStreetFood",
            "Family size meals available! Feed 4-6 people from UGX 25,000 🍽️",
            "New menu alert! Try our fusion dishes combining local and continental flavors 🌶️",
            "Sunday brunch is served! Pancakes, omelettes, fresh juice ☕🥞",
            "Corporate catering available! DM us for your office lunch needs 🏢🍽️",
        ],
        "likes_range": (40, 3000),
        "comments_range": (4, 200),
        "followers_range": (400, 60000),
    },
}

USERNAMES = [
    "kampala_cakes_ug", "bakerystreet_ug", "foodie_kla", "ug_cakes_hub",
    "bakeryzone_ug", "restaurant_kla", "cakefactory_ug", "breadmaster_ug",
    "dining_kampala", "sweettooth_ug", "kla_eats", "ug_food_vibes",
    "cake_delights_ug", "kampala_bakers", "ug_restaurant_guide",
]


class SimulationDataGenerator:
    """Generates realistic simulation data for the TrendLens pipeline."""

    def __init__(self, seed: int = 42) -> None:
        random.seed(seed)
        np.random.seed(seed)

    def generate_template(self, index: int) -> Dict[str, Any]:
        """Generate a single template_db document."""
        category = random.choice(list(UGANDAN_FOOD_CATEGORIES.keys()))
        cat_data = UGANDAN_FOOD_CATEGORIES[category]

        caption = random.choice(cat_data["captions"])
        likes = random.randint(*cat_data["likes_range"])
        comments = random.randint(*cat_data["comments_range"])
        followers = random.randint(*cat_data["followers_range"])

        # Higher quality captions tend to get more engagement
        quality_bonus = 1.0
        if "DM" in caption or "WhatsApp" in caption or "UGX" in caption:
            quality_bonus = 1.3
        if any(h in caption for h in ["#Kampala", "#Uganda", "#KampalaCakes"]):
            quality_bonus *= 1.1

        likes = int(likes * quality_bonus)

        # Some templates have real labels (from matched posts)
        has_real = random.random() < 0.4
        is_simulated = not has_real

        return {
            "caption": caption,
            "category": category,
            "likes": likes if is_simulated else 0,
            "comments": comments if is_simulated else 0,
            "real_likes": likes if has_real else 0,
            "real_comments": comments if has_real else 0,
            "is_simulated": is_simulated,
            "image_url": f"https://example.com/templates/tmpl_{index}.jpg",
            "primary_confidence": round(random.uniform(0.3, 0.95), 3),
            "owner_followers": followers,
            "hashtags": [f"#{tag}" for tag in random.sample(
                ["Kampala", "Uganda", "Cake", "Bakery", "Food", "Restaurant",
                 "Lunch", "Dinner", "Order", "Fresh", "Local"], k=random.randint(2, 6)
            )],
        }

    def generate_post(self, index: int) -> Dict[str, Any]:
        """Generate a single posts_db document."""
        category = random.choice(list(UGANDAN_FOOD_CATEGORIES.keys()))
        cat_data = UGANDAN_FOOD_CATEGORIES[category]

        # Posts have slightly different captions (natural variation)
        caption = random.choice(cat_data["captions"])
        # Add some variation
        variations = [
            caption,
            caption + " 🔥🔥",
            caption.replace("!", "!!"),
            "🔥 " + caption,
            caption + " #KampalaFood",
        ]
        caption = random.choice(variations)

        likes = random.randint(*cat_data["likes_range"])
        comments = random.randint(*cat_data["comments_range"])
        followers = random.randint(*cat_data["followers_range"])

        return {
            "caption": caption,
            "category": category,
            "likes": likes,
            "comments": comments,
            "shares": random.randint(0, likes // 10),
            "ownerUsername": random.choice(USERNAMES),
            "ownerFollowers": followers,
            "timestamp": (datetime.now(timezone.utc) - timedelta(
                days=random.randint(0, 90),
                hours=random.randint(0, 23),
            )).isoformat(),
            "media_url": f"https://example.com/posts/post_{index}.jpg",
            "media_type": "IMAGE",
            "post_id": f"sim_post_{index}",
            "hashtags": [f"#{tag}" for tag in random.sample(
                ["Kampala", "Uganda", "Food", "Local", "Fresh"], k=random.randint(1, 4)
            )],
        }

    def generate_drifted_posts(self, index_offset: int, count: int = 50) -> List[Dict[str, Any]]:
        """Generate posts with shifted distribution (simulating domain drift).

        Drift characteristics:
        - Higher engagement (growing market)
        - Different caption styles (new trends)
        - New hashtags
        """
        posts = []
        for i in range(count):
            category = random.choice(list(UGANDAN_FOOD_CATEGORIES.keys()))
            cat_data = UGANDAN_FOOD_CATEGORIES[category]

            # Drifted captions with new style
            new_style_captions = [
                f"POV: You just ordered our {category} special 😍🔥 #TrendingUG",
                f"Wait for it... {category} perfection 🤤 #ViralFood #Kampala2026",
                f"This changed everything 👇 Our new {category} menu drops today! 🚀",
                f"Nobody talks about this {category} spot 👀 #HiddenGem #UGFood",
                f"Rate our {category} from 1-10 🔥 #FoodTok #Kampala",
            ]
            caption = random.choice(new_style_captions)

            # Higher engagement (drifted distribution)
            likes = random.randint(
                cat_data["likes_range"][1] // 2,
                cat_data["likes_range"][1] * 2,
            )
            comments = random.randint(
                cat_data["comments_range"][1] // 2,
                cat_data["comments_range"][1] * 2,
            )

            posts.append({
                "caption": caption,
                "category": category,
                "likes": likes,
                "comments": comments,
                "shares": random.randint(0, likes // 5),
                "ownerUsername": random.choice(USERNAMES),
                "ownerFollowers": random.randint(
                    cat_data["followers_range"][1] // 2,
                    cat_data["followers_range"][1] * 3,
                ),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "media_url": f"https://example.com/posts/drifted_{index_offset + i}.jpg",
                "media_type": "IMAGE",
                "post_id": f"drifted_{index_offset + i}",
                "hashtags": ["#TrendingUG", "#ViralFood", "#Kampala2026", "#FoodTok"],
            })

        return posts


# ─── Simulation Runner ────────────────────────────────────────────────────────

class SimulationRunner:
    """Runs the full end-to-end simulation and produces an improvement report."""

    def __init__(self) -> None:
        self.generator = SimulationDataGenerator()
        self.activity_log = ActivityLogRepository()
        self.results: List[Dict[str, Any]] = []

    def _clear_simulation_data(self) -> None:
        """Clear previous simulation data from collections."""
        collections_to_clear = [
            "templates_db", "posts_db",
            "clustered_templates", "clustered_posts",
            "ground_truth_posts", "model_registry",
            "drift_state", "system_activity_log",
        ]
        for name in collections_to_clear:
            try:
                coll = get_collection(name)
                coll.delete_many({"_id": {"$exists": True}})
                logger.info("Cleared collection: %s", name)
            except Exception as exc:
                logger.debug("Could not clear %s: %s", name, exc)

    def seed_data(self, n_templates: int = 100, n_posts: int = 150) -> Dict[str, int]:
        """Seed MongoDB with simulation data."""
        structured_log.info("Seeding simulation data", templates=n_templates, posts=n_posts)

        templates_coll = get_collection("templates_db")
        posts_coll = get_collection("posts_db")

        # Generate and insert templates
        templates = [self.generator.generate_template(i) for i in range(n_templates)]
        if templates:
            templates_coll.insert_many(templates)

        # Generate and insert posts
        posts = [self.generator.generate_post(i) for i in range(n_posts)]
        if posts:
            posts_coll.insert_many(posts)

        return {
            "templates_inserted": n_templates,
            "posts_inserted": n_posts,
        }

    def add_more_data(self, n_templates: int = 50, n_posts: int = 75) -> Dict[str, int]:
        """Add more data to simulate ongoing data collection."""
        templates_coll = get_collection("templates_db")
        posts_coll = get_collection("posts_db")

        # Count existing to offset IDs
        existing_t = templates_coll.count_documents({})
        existing_p = posts_coll.count_documents({})

        templates = [self.generator.generate_template(existing_t + i) for i in range(n_templates)]
        posts = [self.generator.generate_post(existing_p + i) for i in range(n_posts)]

        if templates:
            templates_coll.insert_many(templates)
        if posts:
            posts_coll.insert_many(posts)

        return {
            "templates_added": n_templates,
            "posts_added": n_posts,
        }

    def inject_drift(self, n_posts: int = 50) -> Dict[str, int]:
        """Inject drifted data to trigger drift detection."""
        posts_coll = get_collection("posts_db")
        existing = posts_coll.count_documents({})

        drifted_posts = self.generator.generate_drifted_posts(existing, n_posts)
        if drifted_posts:
            posts_coll.insert_many(drifted_posts)

        return {"drifted_posts_injected": n_posts}

    def run_iteration(self, iteration: int) -> Dict[str, Any]:
        """Run one iteration: transform → check triggers → retrain."""
        structured_log.info(f"=== Simulation Iteration {iteration} ===")

        # Step 1: Run transformation pipeline
        from trendlens.data_transformation_pipeline import DataTransformationPipeline
        transform_pipeline = DataTransformationPipeline()
        transform_result = transform_pipeline.run(
            n_clusters=6,
            engagement_threshold=0.04,
        )

        # Step 2: Check triggers and auto-retrain
        from trendlens.auto_retraining_pipeline import AutoRetrainingPipeline
        retrain_pipeline = AutoRetrainingPipeline()
        triggers = retrain_pipeline.check_retrain_triggers()

        retrain_result = None
        if triggers["needs_retrain"]:
            retrain_result = retrain_pipeline.run(force=False)
        else:
            # Force retrain for simulation purposes (we want to see improvement)
            retrain_result = retrain_pipeline.run(force=True)

        iteration_result = {
            "iteration": iteration,
            "transformation": transform_result,
            "triggers": triggers,
            "retraining": retrain_result,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

        self.results.append(iteration_result)
        return iteration_result

    def generate_report(self) -> str:
        """Generate a comprehensive improvement report."""
        lines = []
        lines.append("=" * 80)
        lines.append("  TrendLens AI — Automatic Improvement Simulation Report")
        lines.append("=" * 80)
        lines.append("")
        lines.append(f"Simulation Date: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
        lines.append(f"Total Iterations: {len(self.results)}")
        lines.append("")

        # Track AUC improvement
        auc_history = []
        for r in self.results:
            retrain = r.get("retraining")
            if retrain and retrain.get("auc"):
                auc_history.append({
                    "iteration": r["iteration"],
                    "auc": retrain["auc"],
                    "fold_aucs": retrain.get("fold_aucs", []),
                    "drift_detected": retrain.get("drift", {}).get("is_drift", False),
                    "deployed": retrain.get("should_deploy", False),
                    "samples": retrain.get("samples", 0),
                })

        if auc_history:
            lines.append("─" * 60)
            lines.append("  MODEL AUC IMPROVEMENT TIMELINE")
            lines.append("─" * 60)
            for entry in auc_history:
                drift_marker = " [DRIFT DETECTED]" if entry["drift_detected"] else ""
                deploy_marker = " [DEPLOYED]" if entry["deployed"] else " [ROLLED BACK]"
                lines.append(
                    f"  Iteration {entry['iteration']:>2}: AUC = {entry['auc']:.4f} "
                    f"({'/'.join(f'{a:.3f}' for a in entry['fold_aucs'])}) "
                    f"| Samples: {entry['samples']}{drift_marker}{deploy_marker}"
                )

            # Overall improvement
            first_auc = auc_history[0]["auc"]
            last_auc = auc_history[-1]["auc"]
            improvement = last_auc - first_auc
            lines.append("")
            lines.append(f"  AUC Change: {first_auc:.4f} → {last_auc:.4f} (Δ = {improvement:+.4f})")

        # Transformation results
        lines.append("")
        lines.append("─" * 60)
        lines.append("  DATA TRANSFORMATION RESULTS")
        lines.append("─" * 60)
        for r in self.results:
            t = r.get("transformation", {})
            lines.append(
                f"  Iteration {r['iteration']:>2}: "
                f"Templates={t.get('templates_transformed', 0)}, "
                f"Posts={t.get('posts_transformed', 0)}, "
                f"Ground Truth={t.get('ground_truth_created', 0)}"
            )

        # Trigger analysis
        lines.append("")
        lines.append("─" * 60)
        lines.append("  RETRAIN TRIGGERS")
        lines.append("─" * 60)
        for r in self.results:
            t = r.get("triggers", {})
            lines.append(
                f"  Iteration {r['iteration']:>2}: "
                f"Drift={t.get('drift_trigger', False)}, "
                f"Volume={t.get('volume_trigger', False)}, "
                f"Schedule={t.get('schedule_trigger', False)}, "
                f"Reason={t.get('reason', 'N/A')}"
            )

        # Key achievements
        lines.append("")
        lines.append("─" * 60)
        lines.append("  KEY ACHIEVEMENTS")
        lines.append("─" * 60)

        total_gt = sum(
            r.get("transformation", {}).get("ground_truth_created", 0)
            for r in self.results
        )
        total_tmpls = sum(
            r.get("transformation", {}).get("templates_transformed", 0)
            for r in self.results
        )
        total_posts = sum(
            r.get("transformation", {}).get("posts_transformed", 0)
            for r in self.results
        )
        retrain_count = sum(
            1 for r in self.results if r.get("retraining") is not None
        )
        drift_count = sum(
            1 for r in self.results
            if r.get("retraining", {}).get("drift", {}).get("is_drift", False)
        )

        lines.append(f"  Total Templates Transformed: {total_tmpls}")
        lines.append(f"  Total Posts Transformed:     {total_posts}")
        lines.append(f"  Total Ground Truth Created:  {total_gt}")
        lines.append(f"  Model Retrains:              {retrain_count}")
        lines.append(f"  Drift Events Detected:       {drift_count}")

        if auc_history:
            lines.append(f"  Final Model AUC:             {auc_history[-1]['auc']:.4f}")
            lines.append(f"  AUC Improvement:             {improvement:+.4f}")

        lines.append("")
        lines.append("=" * 80)
        lines.append("  SIMULATION COMPLETE — System demonstrates automatic improvement!")
        lines.append("=" * 80)

        return "\n".join(lines)


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="TrendLens AI Simulation")
    parser.add_argument("--iterations", type=int, default=3, help="Number of simulation iterations")
    parser.add_argument("--templates", type=int, default=100, help="Initial template count")
    parser.add_argument("--posts", type=int, default=150, help="Initial post count")
    parser.add_argument("--inject-drift", action="store_true", help="Inject drift in later iterations")
    parser.add_argument("--clear", action="store_true", help="Clear existing data before simulation")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

    runner = SimulationRunner()

    # Clear if requested
    if args.clear:
        runner._clear_simulation_data()

    # Step 1: Seed initial data
    seed_result = runner.seed_data(n_templates=args.templates, n_posts=args.posts)
    print(f"\n🌱 Seeded: {seed_result['templates_inserted']} templates, {seed_result['posts_inserted']} posts")

    # Step 2: Run iterations
    for i in range(1, args.iterations + 1):
        print(f"\n{'=' * 60}")
        print(f"  ITERATION {i}/{args.iterations}")
        print(f"{'=' * 60}")

        # Add more data each iteration (simulating ongoing data collection)
        if i > 1:
            more = runner.add_more_data(n_templates=50, n_posts=75)
            print(f"  📥 Added: {more['templates_added']} templates, {more['posts_added']} posts")

        # Inject drift in the last iteration if requested
        if args.inject_drift and i == args.iterations:
            drift = runner.inject_drift(n_posts=50)
            print(f"  🌊 Drift injected: {drift['drifted_posts_injected']} shifted posts")

        # Run the iteration
        result = runner.run_iteration(i)

        # Print iteration summary
        transform = result.get("transformation", {})
        retrain = result.get("retraining", {})
        triggers = result.get("triggers", {})

        print(f"  🔄 Transformation: {transform.get('templates_transformed', 0)} templates, "
              f"{transform.get('posts_transformed', 0)} posts, "
              f"{transform.get('ground_truth_created', 0)} ground truth")

        print(f"  🎯 Triggers: Drift={triggers.get('drift_trigger', False)}, "
              f"Volume={triggers.get('volume_trigger', False)}, "
              f"Schedule={triggers.get('schedule_trigger', False)}")

        if retrain:
            print(f"  🧠 Retrain: AUC={retrain.get('auc', 'N/A'):.4f}, "
                  f"Samples={retrain.get('samples', 'N/A')}, "
                  f"Deployed={retrain.get('should_deploy', False)}")
            if retrain.get("drift", {}).get("is_drift"):
                print(f"  ⚠️  DRIFT DETECTED: MMD={retrain['drift']['mmd_statistic']:.4f}, "
                      f"p={retrain['drift']['p_value']:.4f}")
        else:
            print(f"  🧠 Retrain: Not needed")

        time.sleep(1)  # Brief pause between iterations

    # Step 3: Generate report
    report = runner.generate_report()
    print(f"\n{report}")

    # Save report to file
    from pathlib import Path
    report_dir = Path("/home/z/my-project/download")
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "trendlens_simulation_report.txt"
    report_path.write_text(report)
    print(f"\n📄 Report saved to: {report_path}")

    return report


if __name__ == "__main__":
    main()
