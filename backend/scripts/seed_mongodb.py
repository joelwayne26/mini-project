"""
TrendLens AI v6.0 — MongoDB Seed Script
Populates MongoDB with realistic Ugandan food business data.

Usage:
  python -m scripts.seed_mongodb
  python -m scripts.seed_mongodb --clean
  MONGO_URI=mongodb://user:pass@host:port python -m scripts.seed_mongodb
"""

import os
import sys
import math
import random
import re
from datetime import datetime, timezone, timedelta

# Add parent dir to path so we can import trendlens
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGO_DB_NAME", "trendlens")
CLEAN = "--clean" in sys.argv

from pymongo import MongoClient

CATEGORIES = ["cake", "bakery", "restaurant", "general"]

SAMPLE_CAPTIONS = {
    "cake": [
        "Beautiful custom wedding cake just finished! DM to order yours. #CakeKampala #UgandanBakery #WeddingCake #CustomCakes #KampalaEats",
        "Fresh from the oven! Chocolate layer cake UGX 85,000. WhatsApp 0700 123456 to order. #ChocolateCake #KampalaBakery #UGX",
        "Our signature red velvet cake is perfect for any celebration. Starting at UGX 120,000. Link in bio! #RedVelvet #CakeUganda #Celebration",
        "Baby shower cake ideas! DM us for custom designs. Prices from UGX 65,000. #BabyShowerCake #KampalaCakes #CustomDesign",
        "3-tier wedding cake with sugar flowers. Order 2 weeks in advance. Call 0772 987654. #WeddingCakeKampala #SugarFlowers #UgandaWeddings",
        "Try our new passion fruit cake! UGX 45,000 for 1kg. DM to order. #PassionFruit #TropicalCake #UgandanFlavors",
        "Birthday cake special! Free delivery in Kampala. UGX 55,000. WhatsApp 0700 555123. #BirthdayCake #KampalaDelivery #FreeDelivery",
        "Engagement cakes that make memories. Starting UGX 150,000. Link in bio. #EngagementCake #KampalaLove #CustomCake",
        "Mini cupcakes for your office party! UGX 3,000 each. DM to order. #Cupcakes #OfficeParty #KampalaEvents",
        "Our bestseller: vanilla bean cake with buttercream frosting. UGX 70,000. WhatsApp to order. #VanillaCake #Bestseller #KampalaBakery",
    ],
    "bakery": [
        "Fresh bread every morning! Whole wheat UGX 5,000, white loaf UGX 4,000. #FreshBread #KampalaBakery #MorningFresh",
        "Cinnamon rolls just out of the oven! UGX 8,000 each. DM to reserve. #CinnamonRolls #PastryLovers #KampalaEats",
        "Samosa platter for your event! 50 pieces UGX 75,000. WhatsApp 0700 999888. #Samosa #UgandanSnacks #EventCatering",
        "Fresh mandazi and chapati breakfast combo UGX 7,000! Open 6am-10am daily. #Mandazi #Chapati #BreakfastKampala",
        "Artisan sourdough bread now available! UGX 12,000. Limited stock daily. #Sourdough #ArtisanBread #KampalaFoodies",
        "Our famous Rolex rolls! Chapati + eggs UGX 5,000. Best in Kampala! #Rolex #UgandanStreetFood #KampalaStreetFood",
        "Wedding pastry boxes starting UGX 150,000 for 100 pcs. DM for catalogue. #WeddingPastries #UgandaWeddings #BakeryKampala",
        "Gluten-free banana bread! UGX 15,000. DM to pre-order. #GlutenFree #HealthyBaking #KampalaHealth",
        "Fresh doughnuts! Glazed UGX 3,000, filled UGX 4,000. While stocks last! #Doughnuts #KampalaSnacks #FreshBaked",
        "Corporate breakfast catering available. DM for quote. #CorporateCatering #BreakfastMeeting #KampalaBusiness",
    ],
    "restaurant": [
        "Lunch special: Matooke + G-nut sauce + rice UGX 15,000! Dine-in or takeaway. #LunchSpecial #UgandanFood #KampalaRestaurant",
        "Our Rolex is voted best in Kampala! Fresh chapati + 2 eggs UGX 6,000. #BestRolex #StreetFood #KampalaEats",
        "Friday special: Grilled tilapia with sweet potato UGX 25,000. Reserve your table! 0772 111222. #Tilapia #FridayDinner #Kampala",
        "Luweero chicken prepared the traditional way! UGX 20,000 half, UGX 35,000 whole. #LocalChicken #TraditionalFood #Uganda",
        "Buffet lunch every Sunday UGX 35,000 per person. Kids under 5 eat free! #SundayBuffet #FamilyDining #KampalaLunch",
        "Fresh juice combo: Mango + Passion fruit UGX 8,000. #FreshJuice #UgandanFruits #HealthyEating",
        "Evening BBQ platter for 2 UGX 45,000. Includes goat meat, chicken, sides. #BBQ #EveningVibes #KampalaNightlife",
        "Breakfast of champions: Rolex + African tea UGX 8,000. Open from 6am! #Breakfast #Rolex #MorningVibes",
        "Private dining room available for events up to 30 guests. Call 0312 456789. #PrivateDining #Events #KampalaEvents",
        "New on the menu: Grilled goat ribs with irish potatoes UGX 22,000! #GoatRibs #NewMenu #UgandanBBQ",
    ],
    "general": [
        "Support local! Buy fresh produce directly from Ugandan farmers. #BuyLocal #UgandanFarmers #SupportLocal",
        "Food hygiene tip: Always wash your produce thoroughly! #FoodSafety #HealthyEating #Uganda",
        "This weekend's food market at Lugogo! Over 50 vendors. Free entry. #FoodMarket #KampalaEvents #WeekendVibes",
        "Uganda's coffee is among the best in the world! Try a cup today. #UgandaCoffee #SpecialtyCoffee #AfricanCoffee",
        "Recipe: How to make the perfect Luwombo at home. Link in bio! #Luwombo #UgandanRecipe #HomeCooking",
        "New restaurant alert! Opening in Nakawa this Saturday. #NewRestaurant #KampalaFood #OpeningDay",
        "Street food guide: Top 10 must-try foods in Kampala. #StreetFood #KampalaGuide #Foodie",
        "Farm to table: Why sourcing locally matters for your restaurant. #FarmToTable #Sustainability #UgandanAgriculture",
        "Ugandan vanilla is world-class! Supporting vanilla farmers in Mbale. #Vanilla #UgandanExports #FarmDirect",
        "Happy hour deals across Kampala this week! Tag your drinking buddy. #HappyHour #KampalaNightlife #Deals",
    ],
}

PLATFORMS = ["instagram", "twitter", "facebook"]


def random_float(min_val, max_val, decimals=4):
    return Number((random.random() * (max_val - min_val) + min_val).toFixed(decimals))


def random_int(min_val, max_val):
    return random.randint(min_val, max_val)


def pick_random(arr):
    return arr[random.randint(0, len(arr) - 1)]


def text_to_embedding(text):
    """Simple TF-based 384-dim embedding from text."""
    dim = 384
    words = re.findall(r'[a-z]{3,}', text.lower())
    embedding = [0.0] * dim
    for word in words:
        hash_val = 0
        for ch in word:
            hash_val = ((hash_val << 5) - hash_val + ord(ch)) | 0
        idx = abs(hash_val) % dim
        embedding[idx] += 1
    embedding[dim - 1] = len(words) / 50
    embedding[dim - 2] = len(re.findall(r'#', text)) / 15
    embedding[dim - 3] = 1.0 if re.search(r'ugx|ush|\$', text, re.I) else 0.0
    embedding[dim - 4] = 1.0 if re.search(r'dm|whatsapp|link in bio|order', text, re.I) else 0.0
    norm = math.sqrt(sum(v * v for v in embedding)) or 1
    return [round(v / norm, 6) for v in embedding]


def classify_from_caption(caption):
    lower = caption.lower()
    if re.search(r'cake|wedding cake|birthday cake|cupcake|red velvet', lower, re.I):
        return 'cake'
    if re.search(r'bread|bakery|pastry|sourdough|dough|roll|mandazi|samosa', lower, re.I):
        return 'bakery'
    if re.search(r'restaurant|lunch|dinner|buffet|dine|menu|tilapia|goat|bbq', lower, re.I):
        return 'restaurant'
    return 'general'


def seed_posts(db):
    collection = db["posts"]
    docs = []
    for category in CATEGORIES:
        for caption in SAMPLE_CAPTIONS[category]:
            docs.append({
                "caption": caption,
                "category": category,
                "engagement_rate": round(random.random() * 0.14 + 0.01, 4),
                "hashtags": re.findall(r'#(\w+)', caption),
                "has_cta": bool(re.search(r'dm|whatsapp|link in bio|order|call|reserve', caption, re.I)),
                "has_price": bool(re.search(r'ugx|ush|\$', caption, re.I)),
                "platform": pick_random(PLATFORMS),
                "likes": random.randint(20, 5000),
                "comments": random.randint(2, 300),
                "shares": random.randint(5, 800),
                "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 90))).isoformat(),
            })
    # Extra variations
    for i in range(30):
        cat = pick_random(CATEGORIES)
        caption = pick_random(SAMPLE_CAPTIONS[cat]) + ' ' + pick_random(['#Fresh', '#Tasty', '#Kampala', '#Uganda', '#Foodie', '#Delicious'])
        docs.append({
            "caption": caption,
            "category": cat,
            "engagement_rate": round(random.random() * 0.10 + 0.02, 4),
            "hashtags": re.findall(r'#(\w+)', caption),
            "has_cta": random.random() > 0.3,
            "has_price": random.random() > 0.4,
            "platform": pick_random(PLATFORMS),
            "likes": random.randint(50, 3000),
            "comments": random.randint(5, 200),
            "shares": random.randint(10, 500),
            "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 60))).isoformat(),
        })
    if CLEAN:
        collection.delete_many({})
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} posts")


def seed_ground_truth(db):
    collection = db["ground_truth_posts"]
    docs = []
    for category in CATEGORIES:
        for caption in SAMPLE_CAPTIONS[category]:
            er = round(random.random() * 0.15 + 0.05, 4)
            docs.append({
                "caption": caption,
                "category": category,
                "engagement_rate": er,
                "label": "high" if er > 0.1 else ("medium" if er > 0.05 else "low"),
                "score": round(er * 50 + random.random() * 4 + 3, 1),
                "hashtags": re.findall(r'#(\w+)', caption),
                "has_cta": bool(re.search(r'dm|whatsapp|link in bio|order|call|reserve', caption, re.I)),
                "has_price": bool(re.search(r'ugx|ush|\$', caption, re.I)),
                "platform": pick_random(PLATFORMS),
                "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 180))).isoformat(),
            })
    if CLEAN:
        collection.delete_many({})
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} ground_truth_posts")


def seed_embeddings(db):
    collection = db["embeddings"]
    docs = []
    for category in CATEGORIES:
        for caption in SAMPLE_CAPTIONS[category]:
            docs.append({
                "caption": caption,
                "category": category,
                "engagement_rate": round(random.random() * 0.12 + 0.03, 4),
                "embedding": text_to_embedding(caption),
                "hashtags": re.findall(r'#(\w+)', caption),
                "has_cta": bool(re.search(r'dm|whatsapp|link in bio|order|call|reserve', caption, re.I)),
                "has_price": bool(re.search(r'ugx|ush|\$', caption, re.I)),
                "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 90))).isoformat(),
            })
    if CLEAN:
        collection.delete_many({})
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} embeddings")


def seed_model_registry(db):
    collection = db["model_registry"]
    if CLEAN:
        collection.delete_many({})
    docs = [
        {"model_type": "xgboost", "version": "v6.0.0", "auc": 0.8742, "samples": 250, "features": ["hashtag_count", "has_cta", "has_price", "word_count", "sentiment", "trend_alignment", "emoji_count", "readability"], "fold_aucs": [0.86, 0.89, 0.85, 0.88, 0.87], "trained_at": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(), "status": "production"},
        {"model_type": "xgboost", "version": "v5.2.0", "auc": 0.8521, "samples": 180, "features": ["hashtag_count", "has_cta", "has_price", "word_count", "sentiment", "emoji_count"], "fold_aucs": [0.84, 0.87, 0.83, 0.86, 0.85], "trained_at": (datetime.now(timezone.utc) - timedelta(days=21)).isoformat(), "status": "archived"},
        {"model_type": "xgboost", "version": "v5.0.0", "auc": 0.8190, "samples": 120, "features": ["hashtag_count", "has_cta", "has_price", "word_count"], "fold_aucs": [0.80, 0.83, 0.79, 0.84, 0.82], "trained_at": (datetime.now(timezone.utc) - timedelta(days=45)).isoformat(), "status": "archived"},
    ]
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} model_registry entries")


def seed_drift_state(db):
    collection = db["drift_state"]
    if CLEAN:
        collection.delete_many({})
    docs = []
    for i in range(10):
        mmd = round(random.random() * 0.14 + 0.01, 4)
        docs.append({
            "mmd_score": mmd,
            "p_value": round(random.random() * 0.49 + 0.01, 4),
            "is_drift": mmd > 0.1 and random.random() > 0.5,
            "sample_size": random.randint(30, 100),
            "baseline_stats": {"mean": round(random.random() * 0.2 + 0.4, 4), "std": round(random.random() * 0.2 + 0.1, 4)},
            "timestamp": (datetime.now(timezone.utc) - timedelta(days=i)).isoformat(),
            "created_at": (datetime.now(timezone.utc) - timedelta(days=i)).isoformat(),
        })
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} drift_state measurements")


def seed_trend_snapshots(db):
    collection = db["trend_snapshots"]
    if CLEAN:
        collection.delete_many({})
    trends = [
        {"keyword": "wedding cake Kampala", "category": "cake", "source": "google_trends"},
        {"keyword": "custom cakes Uganda", "category": "cake", "source": "google_trends"},
        {"keyword": "red velvet cake", "category": "cake", "source": "instagram"},
        {"keyword": "sourdough bread Kampala", "category": "bakery", "source": "google_trends"},
        {"keyword": "fresh bread delivery", "category": "bakery", "source": "instagram"},
        {"keyword": "pastry shop Uganda", "category": "bakery", "source": "google_trends"},
        {"keyword": "rolex Kampala", "category": "restaurant", "source": "google_trends"},
        {"keyword": "matooke restaurant", "category": "restaurant", "source": "google_trends"},
        {"keyword": "tilapia dinner", "category": "restaurant", "source": "instagram"},
        {"keyword": "local food Uganda", "category": "general", "source": "google_trends"},
        {"keyword": "Uganda coffee", "category": "general", "source": "google_trends"},
        {"keyword": "street food Kampala", "category": "general", "source": "instagram"},
        {"keyword": "grilled meat Uganda", "category": "restaurant", "source": "google_trends"},
        {"keyword": "birthday cake delivery", "category": "cake", "source": "instagram"},
        {"keyword": "chapati recipe", "category": "bakery", "source": "google_trends"},
    ]
    docs = [{
        "keyword": t["keyword"],
        "category": t["category"],
        "source": t["source"],
        "score": round(random.random() * 0.65 + 0.3, 4),
        "volume": random.randint(1000, 50000),
        "growth_rate": round(random.random() * 0.35 - 0.05, 4),
        "fetched_at": (datetime.now(timezone.utc) - timedelta(hours=random.randint(0, 48))).isoformat(),
    } for t in trends]
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} trend_snapshots")


def seed_evaluations(db):
    collection = db["evaluations"]
    if CLEAN:
        collection.delete_many({})
    docs = []
    for category in CATEGORIES:
        for i in range(5):
            docs.append({
                "caption": pick_random(SAMPLE_CAPTIONS[category]),
                "image_url": "",
                "overall_score": round(random.random() * 6 + 3, 1),
                "poster_score": round(random.random() * 6 + 3, 1),
                "caption_score": round(random.random() * 6 + 3, 1),
                "category": category,
                "model_version": "heuristic",
                "shap_values": [
                    {"feature": "hashtag_count", "contribution": round(random.random() * 3 - 1, 3)},
                    {"feature": "has_cta", "contribution": round(random.random() * 2 - 1, 3)},
                    {"feature": "has_price", "contribution": round(random.random() * 1.5 - 0.5, 3)},
                    {"feature": "word_count", "contribution": round(random.random() * 1 - 0.5, 3)},
                    {"feature": "sentiment", "contribution": round(random.random() * 1 - 0.5, 3)},
                ],
                "rag_insights_count": random.randint(0, 5),
                "evaluated_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 30))).isoformat(),
                "created_at": (datetime.now(timezone.utc) - timedelta(days=random.randint(0, 30))).isoformat(),
            })
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} evaluations")


def seed_feedback(db):
    collection = db["user_feedback"]
    if CLEAN:
        collection.delete_many({})
    docs = [
        {"evaluation_id": "demo-1", "feedback_type": "thumbs_up", "score": 7.2, "comment": "", "timestamp": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
        {"evaluation_id": "demo-2", "feedback_type": "thumbs_up", "score": 8.1, "comment": "", "timestamp": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()},
        {"evaluation_id": "demo-3", "feedback_type": "thumbs_down", "score": 4.5, "comment": "Score too low", "timestamp": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()},
        {"evaluation_id": "demo-4", "feedback_type": "thumbs_up", "score": 9.0, "comment": "", "timestamp": (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()},
        {"evaluation_id": "demo-5", "feedback_type": "thumbs_down", "score": 3.2, "comment": "Missing OCR", "timestamp": (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()},
    ]
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} user_feedback entries")


def seed_activity_log(db):
    collection = db["system_activity_log"]
    if CLEAN:
        collection.delete_many({})
    docs = [
        {"event_type": "startup", "message": "TrendLens AI v6.0 started", "metadata": {"version": "6.0.0"}, "created_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(), "timestamp": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()},
        {"event_type": "evaluation", "message": "First evaluation completed", "metadata": {"score": 7.2}, "created_at": (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat(), "timestamp": (datetime.now(timezone.utc) - timedelta(hours=20)).isoformat()},
        {"event_type": "retrain", "message": "XGBoost model retrained", "metadata": {"auc": 0.87}, "created_at": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(), "timestamp": (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()},
        {"event_type": "drift_check", "message": "No drift detected", "metadata": {"mmd": 0.03}, "created_at": (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat(), "timestamp": (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()},
        {"event_type": "seed", "message": "Database seeded with sample data", "metadata": {}, "created_at": datetime.now(timezone.utc).isoformat(), "timestamp": datetime.now(timezone.utc).isoformat()},
    ]
    collection.insert_many(docs)
    print(f"  Seeded {len(docs)} system_activity_log entries")


def create_indexes(db):
    print("\n  Creating indexes...")
    db["posts"].create_index([("category", 1), ("engagement_rate", -1)])
    db["ground_truth_posts"].create_index([("category", 1), ("label", 1)])
    db["ground_truth_posts"].create_index([("engagement_rate", -1)])
    db["embeddings"].create_index([("category", 1)])
    db["model_registry"].create_index([("model_type", 1), ("trained_at", -1)])
    db["drift_state"].create_index([("timestamp", -1)])
    db["trend_snapshots"].create_index([("category", 1), ("fetched_at", -1)])
    db["evaluations"].create_index([("evaluated_at", -1)])
    db["evaluations"].create_index([("category", 1)])
    db["user_feedback"].create_index([("feedback_type", 1)])
    db["system_activity_log"].create_index([("event_type", 1), ("created_at", -1)])
    print("  All indexes created")


def main():
    print("TrendLens AI v6.0 - MongoDB Seed Script")
    uri_display = MONGO_URI.split('@')[-1] if '@' in MONGO_URI else MONGO_URI
    print(f"  URI: ***@{uri_display}")
    print(f"  DB:  {DB_NAME}")
    print(f"  Clean: {CLEAN}\n")

    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000, connectTimeoutMS=5000)

    try:
        client.admin.command("ping")
        print("  Connected to MongoDB\n")

        db = client[DB_NAME]

        print("  Seeding collections...\n")
        seed_posts(db)
        seed_ground_truth(db)
        seed_embeddings(db)
        seed_model_registry(db)
        seed_drift_state(db)
        seed_trend_snapshots(db)
        seed_evaluations(db)
        seed_feedback(db)
        seed_activity_log(db)

        create_indexes(db)

        print("\n  Seeding complete! TrendLens AI is ready to use.")
        print("  NOTE: For Atlas Vector Search, create index 'vector_index' on 'embedding' with 384 dimensions, cosine similarity")
    except Exception as e:
        print(f"  Seeding failed: {e}")
        sys.exit(1)
    finally:
        client.close()


if __name__ == "__main__":
    main()
