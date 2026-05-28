/**
 * TrendLens AI v6.0 — MongoDB Seed Script
 * Populates MongoDB with realistic Ugandan food business data.
 *
 * Usage:
 *   npx tsx scripts/seed-mongodb.ts                  # Seed all collections
 *   npx tsx scripts/seed-mongodb.ts --clean           # Wipe & re-seed
 *   MONGO_URI=mongodb://user:pass@host:port npx tsx scripts/seed-mongodb.ts
 */

import fs from 'fs';
import path from 'path';
import { MongoClient, Db } from 'mongodb';

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGO_DB_NAME || 'trendlens';
const CLEAN = process.argv.includes('--clean');

// ─── Uganda Food Business Sample Data ────────────────────────────────────────

const CATEGORIES = ['cake', 'bakery', 'restaurant', 'general'] as const;

const SAMPLE_CAPTIONS: Record<string, string[]> = {
  cake: [
    "Beautiful custom wedding cake just finished! DM to order yours. #CakeKampala #UgandanBakery #WeddingCake #CustomCakes #KampalaEats",
    "Fresh from the oven! Chocolate layer cake UGX 85,000. WhatsApp 0700 123456 to order. #ChocolateCake #KampalaBakery #UGX",
    "Our signature red velvet cake is perfect for any celebration. Starting at UGX 120,000. Link in bio! #RedVelvet #CakeUganda #Celebration",
    "Baby shower cake ideas! DM us for custom designs. Prices from UGX 65,000. #BabyShowerCake #KampalaCakes #CustomDesign",
    "3-tier wedding cake with sugar flowers. Order 2 weeks in advance. Call 0772 987654. #WeddingCakeKampala #SugarFlowers #UgandaWeddings",
    "Try our new passion fruit cake! UGX 45,000 for 1kg. DM to order. #PassionFruit #TropicalCake #UgandanFlavors",
    "Birthday cake special! Free delivery in Kampala. UGX 55,000. WhatsApp 0700 555123. #BirthdayCake #KampalaDelivery #FreeDelivery",
    "Engagement cakes that make memories. Starting UGX 150,000. Link in bio to browse designs. #EngagementCake #KampalaLove #CustomCake",
    "Mini cupcakes for your office party! UGX 3,000 each, minimum 12. DM to order. #Cupcakes #OfficeParty #KampalaEvents",
    "Our bestseller: vanilla bean cake with buttercream frosting. UGX 70,000. WhatsApp to order. #VanillaCake #Bestseller #KampalaBakery",
  ],
  bakery: [
    "Fresh bread every morning! Whole wheat UGX 5,000, white loaf UGX 4,000. Come grab yours! #FreshBread #KampalaBakery #MorningFresh",
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
  restaurant: [
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
  general: [
    "Support local! Buy fresh produce directly from Ugandan farmers. #BuyLocal #UgandanFarmers #SupportLocal",
    "Food hygiene tip: Always wash your produce thoroughly! #FoodSafety #HealthyEating #Uganda",
    "This weekend's food market at Lugogo! Over 50 vendors. Free entry. #FoodMarket #KampalaEvents #WeekendVibes",
    "Uganda's coffee is among the best in the world! Try a cup today. #UgandaCoffee #SpecialtyCoffee #AfricanCoffee",
    "Recipe: How to make the perfect Luwombo at home. Link in bio! #Luwombo #UgandanRecipe #HomeCooking",
    "New restaurant alert! Opening in Nakawa this Saturday. Come taste the difference. #NewRestaurant #KampalaFood #OpeningDay",
    "Street food guide: Top 10 must-try foods in Kampala. #StreetFood #KampalaGuide #Foodie",
    "Farm to table: Why sourcing locally matters for your restaurant. #FarmToTable #Sustainability #UgandanAgriculture",
    "Ugandan vanilla is world-class! Supporting vanilla farmers in Mbale. #Vanilla #UgandanExports #FarmDirect",
    "Happy hour deals across Kampala this week! Tag your drinking buddy. #HappyHour #KampalaNightlife #Deals",
  ],
};

const PLATFORMS = ['instagram', 'twitter', 'facebook'] as const;

function randomFloat(min: number, max: number, decimals = 4): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: readonly T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Simple TF-based 384-dim embedding from text */
function textToEmbedding(text: string): number[] {
  const dim = 384;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const vocab: Record<string, number> = {};
  const embedding = new Array(dim).fill(0);
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vocab[word] = (vocab[word] || 0) + 1;
    embedding[idx] += 1;
  }
  // Structural features in last slots
  embedding[dim - 1] = words.length / 50;
  embedding[dim - 2] = (text.match(/#/g) || []).length / 15;
  embedding[dim - 3] = /ugx|ush|\$/i.test(text) ? 1 : 0;
  embedding[dim - 4] = /dm|whatsapp|link in bio|order/i.test(text) ? 1 : 0;
  embedding[dim - 5] = (text.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length / 5;
  // Normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map(v => Number((v / norm).toFixed(6)));
}

// ─── Seed Functions ──────────────────────────────────────────────────────────

async function seedPosts(db: Db) {
  const collection = db.collection('posts');
  const docs = [];
  for (const category of CATEGORIES) {
    for (const caption of SAMPLE_CAPTIONS[category]) {
      docs.push({
        caption,
        category,
        engagement_rate: randomFloat(0.01, 0.15),
        hashtags: (caption.match(/#\w+/g) || []).map(t => t.slice(1)),
        has_cta: /dm|whatsapp|link in bio|order|call|reserve/i.test(caption),
        has_price: /ugx|ush|\$/i.test(caption),
        platform: pickRandom(PLATFORMS),
        likes: randomInt(20, 5000),
        comments: randomInt(2, 300),
        shares: randomInt(5, 800),
        created_at: new Date(Date.now() - randomInt(0, 90) * 86400000).toISOString(),
      });
    }
  }
  // Add more variation
  for (let i = 0; i < 30; i++) {
    const cat = pickRandom(CATEGORIES);
    const caption = pickRandom(SAMPLE_CAPTIONS[cat]);
    docs.push({
      caption: caption + ' ' + ['#Fresh', '#Tasty', '#Kampala', '#Uganda', '#Foodie', '#Delicious'][randomInt(0, 5)],
      category: cat,
      engagement_rate: randomFloat(0.02, 0.12),
      hashtags: (caption.match(/#\w+/g) || []).map(t => t.slice(1)).concat(pickN(['Fresh', 'Tasty', 'Kampala', 'Uganda', 'Foodie', 'Delicious', 'Yummy', 'Local'], randomInt(1, 3))),
      has_cta: Math.random() > 0.3,
      has_price: Math.random() > 0.4,
      platform: pickRandom(PLATFORMS),
      likes: randomInt(50, 3000),
      comments: randomInt(5, 200),
      shares: randomInt(10, 500),
      created_at: new Date(Date.now() - randomInt(0, 60) * 86400000).toISOString(),
    });
  }
  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} posts`);
}

async function seedGroundTruth(db: Db) {
  const collection = db.collection('ground_truth_posts');
  const docs = [];
  for (const category of CATEGORIES) {
    for (const caption of SAMPLE_CAPTIONS[category]) {
      const engagementRate = randomFloat(0.05, 0.2);
      docs.push({
        caption,
        category,
        engagement_rate: engagementRate,
        label: engagementRate > 0.1 ? 'high' : engagementRate > 0.05 ? 'medium' : 'low',
        score: Math.round(engagementRate * 50 + randomFloat(3, 7)),
        hashtags: (caption.match(/#\w+/g) || []).map(t => t.slice(1)),
        has_cta: /dm|whatsapp|link in bio|order|call|reserve/i.test(caption),
        has_price: /ugx|ush|\$/i.test(caption),
        platform: pickRandom(PLATFORMS),
        created_at: new Date(Date.now() - randomInt(0, 180) * 86400000).toISOString(),
      });
    }
  }
  // Extra high-engagement examples
  const highPerformers = [
    "AMAZING wedding cake just delivered! The bride was in tears of joy. DM us to make your dream cake a reality. UGX 200,000+. #WeddingCake #Kampala #Uganda #CustomCakes #DreamWedding #BrideGoals #CakeArt #UgandanBakery #KampalaWeddings #LuxuryCakes",
    "Flash sale! 50% off all pastries TODAY ONLY! UGX 3,000 each. WhatsApp 0700 123456 to reserve. #FlashSale #KampalaBakery #HalfPrice #LimitedOffer #Pastry #FreshBaked #UgandaDeals #KampalaEats",
    "Our Rolex was featured on NTV Uganda! Come taste the best chapati + eggs in Kampala. UGX 5,000. Open 24/7! #NTVFeatured #BestRolex #KampalaStreetFood #Uganda #247 #StreetFoodKing #MustTry",
  ];
  for (const caption of highPerformers) {
    docs.push({
      caption,
      category: classifyFromCaption(caption),
      engagement_rate: randomFloat(0.12, 0.2),
      label: 'high',
      score: randomInt(8, 10),
      hashtags: (caption.match(/#\w+/g) || []).map(t => t.slice(1)),
      has_cta: true,
      has_price: true,
      platform: 'instagram',
      created_at: new Date(Date.now() - randomInt(0, 30) * 86400000).toISOString(),
    });
  }
  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} ground_truth_posts`);
}

async function seedEmbeddings(db: Db) {
  const collection = db.collection('embeddings');
  const docs = [];
  for (const category of CATEGORIES) {
    for (const caption of SAMPLE_CAPTIONS[category]) {
      docs.push({
        caption,
        category,
        engagement_rate: randomFloat(0.03, 0.15),
        embedding: textToEmbedding(caption),
        hashtags: (caption.match(/#\w+/g) || []).map(t => t.slice(1)),
        has_cta: /dm|whatsapp|link in bio|order|call|reserve/i.test(caption),
        has_price: /ugx|ush|\$/i.test(caption),
        created_at: new Date(Date.now() - randomInt(0, 90) * 86400000).toISOString(),
      });
    }
  }
  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} embeddings`);
  console.log('  NOTE: Create Atlas Vector Search index "vector_index" on path "embedding" with 384 dimensions for RAG to work');
}

async function seedModelRegistry(db: Db) {
  const collection = db.collection('model_registry');
  if (CLEAN) await collection.deleteMany({});
  const docs = [
    { model_type: 'xgboost', version: 'v6.0.0', auc: 0.8742, samples: 250, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count', 'sentiment', 'trend_alignment', 'emoji_count', 'readability'], fold_aucs: [0.86, 0.89, 0.85, 0.88, 0.87], trained_at: new Date(Date.now() - 7 * 86400000).toISOString(), status: 'production' },
    { model_type: 'xgboost', version: 'v5.2.0', auc: 0.8521, samples: 180, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count', 'sentiment', 'emoji_count'], fold_aucs: [0.84, 0.87, 0.83, 0.86, 0.85], trained_at: new Date(Date.now() - 21 * 86400000).toISOString(), status: 'archived' },
    { model_type: 'xgboost', version: 'v5.0.0', auc: 0.8190, samples: 120, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count'], fold_aucs: [0.80, 0.83, 0.79, 0.84, 0.82], trained_at: new Date(Date.now() - 45 * 86400000).toISOString(), status: 'archived' },
  ];
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} model_registry entries`);
}

async function seedDriftState(db: Db) {
  const collection = db.collection('drift_state');
  if (CLEAN) await collection.deleteMany({});
  const docs = [];
  for (let i = 0; i < 10; i++) {
    const mmd = randomFloat(0.01, 0.15);
    docs.push({
      mmd_score: mmd,
      p_value: randomFloat(0.01, 0.5),
      is_drift: mmd > 0.1 && Math.random() > 0.5,
      sample_size: randomInt(30, 100),
      baseline_stats: { mean: randomFloat(0.4, 0.6), std: randomFloat(0.1, 0.3) },
      timestamp: new Date(Date.now() - i * 24 * 3600000).toISOString(),
    });
  }
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} drift_state measurements`);
}

async function seedTrendSnapshots(db: Db) {
  const collection = db.collection('trend_snapshots');
  if (CLEAN) await collection.deleteMany({});
  const trends = [
    { keyword: 'wedding cake Kampala', category: 'cake', source: 'google_trends' },
    { keyword: 'custom cakes Uganda', category: 'cake', source: 'google_trends' },
    { keyword: 'red velvet cake', category: 'cake', source: 'instagram' },
    { keyword: 'sourdough bread Kampala', category: 'bakery', source: 'google_trends' },
    { keyword: 'fresh bread delivery', category: 'bakery', source: 'instagram' },
    { keyword: 'pastry shop Uganda', category: 'bakery', source: 'google_trends' },
    { keyword: 'rolex Kampala', category: 'restaurant', source: 'google_trends' },
    { keyword: 'matooke restaurant', category: 'restaurant', source: 'google_trends' },
    { keyword: 'tilapia dinner', category: 'restaurant', source: 'instagram' },
    { keyword: 'local food Uganda', category: 'general', source: 'google_trends' },
    { keyword: 'Uganda coffee', category: 'general', source: 'google_trends' },
    { keyword: 'street food Kampala', category: 'general', source: 'instagram' },
    { keyword: 'grilled meat Uganda', category: 'restaurant', source: 'google_trends' },
    { keyword: 'birthday cake delivery', category: 'cake', source: 'instagram' },
    { keyword: 'chapati recipe', category: 'bakery', source: 'google_trends' },
  ];
  const docs = trends.map(t => ({
    keyword: t.keyword,
    category: t.category,
    source: t.source,
    score: randomFloat(0.3, 0.95),
    volume: randomInt(1000, 50000),
    growth_rate: randomFloat(-0.05, 0.3),
    fetched_at: new Date(Date.now() - randomInt(0, 48) * 3600000).toISOString(),
  }));
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} trend_snapshots`);
}

async function seedEvaluations(db: Db) {
  const collection = db.collection('evaluations');
  if (CLEAN) await collection.deleteMany({});
  const docs = [];
  for (const category of CATEGORIES) {
    for (let i = 0; i < 5; i++) {
      docs.push({
        caption: pickRandom(SAMPLE_CAPTIONS[category]),
        image_url: '',
        overall_score: randomFloat(3, 9, 1),
        poster_score: randomFloat(3, 9, 1),
        caption_score: randomFloat(3, 9, 1),
        category,
        model_version: 'heuristic',
        shap_values: [
          { feature: 'hashtag_count', contribution: randomFloat(-1, 2) },
          { feature: 'has_cta', contribution: randomFloat(-1, 2) },
          { feature: 'has_price', contribution: randomFloat(-1, 1.5) },
          { feature: 'word_count', contribution: randomFloat(-0.5, 1) },
          { feature: 'sentiment', contribution: randomFloat(-0.5, 1) },
        ],
        rag_insights_count: randomInt(0, 5),
        evaluated_at: new Date(Date.now() - randomInt(0, 30) * 86400000).toISOString(),
      });
    }
  }
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} evaluations`);
}

async function seedFeedback(db: Db) {
  const collection = db.collection('user_feedback');
  if (CLEAN) await collection.deleteMany({});
  const docs = [
    { type: 'caption', rating: 'thumbs_up', evaluation_id: 'demo-1', timestamp: new Date(Date.now() - 86400000).toISOString() },
    { type: 'score', rating: 'thumbs_up', evaluation_id: 'demo-2', timestamp: new Date(Date.now() - 2 * 86400000).toISOString() },
    { type: 'caption', rating: 'thumbs_down', evaluation_id: 'demo-3', timestamp: new Date(Date.now() - 3 * 86400000).toISOString() },
    { type: 'suggestion', rating: 'thumbs_up', evaluation_id: 'demo-4', timestamp: new Date(Date.now() - 4 * 86400000).toISOString() },
    { type: 'score', rating: 'thumbs_down', evaluation_id: 'demo-5', timestamp: new Date(Date.now() - 5 * 86400000).toISOString() },
  ];
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} user_feedback entries`);
}

async function seedActivityLog(db: Db) {
  const collection = db.collection('system_activity_log');
  if (CLEAN) await collection.deleteMany({});
  const docs = [
    { event_type: 'startup', message: 'TrendLens AI v6.0 started', metadata: { version: '6.0.0' }, created_at: new Date(Date.now() - 86400000).toISOString() },
    { event_type: 'evaluation', message: 'First evaluation completed', metadata: { score: 7.2 }, created_at: new Date(Date.now() - 20 * 3600000).toISOString() },
    { event_type: 'retrain', message: 'XGBoost model retrained', metadata: { auc: 0.87 }, created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    { event_type: 'drift_check', message: 'No drift detected', metadata: { mmd: 0.03 }, created_at: new Date(Date.now() - 6 * 3600000).toISOString() },
    { event_type: 'seed', message: 'Database seeded with sample data', metadata: {}, created_at: new Date().toISOString() },
  ];
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} system_activity_log entries`);
}

function classifyFromCaption(caption: string): string {
  const lower = caption.toLowerCase();
  if (/cake|wedding cake|birthday cake|cupcake|red velvet/i.test(lower)) return 'cake';
  if (/bread|bakery|pastry|sourdough|dough|roll|mandazi|samosa/i.test(lower)) return 'bakery';
  if (/restaurant|lunch|dinner|buffet|dine|menu|tilapia|goat|bbq/i.test(lower)) return 'restaurant';
  return 'general';
}

// ─── Create Indexes ──────────────────────────────────────────────────────────

async function createIndexes(db: Db) {
  console.log('\n📊 Creating indexes...');

  await db.collection('posts').createIndex({ category: 1, engagement_rate: -1 });
  await db.collection('ground_truth_posts').createIndex({ category: 1, label: 1 });
  await db.collection('ground_truth_posts').createIndex({ engagement_rate: -1 });
  await db.collection('embeddings').createIndex({ category: 1 });
  await db.collection('model_registry').createIndex({ model_type: 1, trained_at: -1 });
  await db.collection('drift_state').createIndex({ timestamp: -1 });
  await db.collection('trend_snapshots').createIndex({ category: 1, fetched_at: -1 });
  await db.collection('evaluations').createIndex({ evaluated_at: -1 });
  await db.collection('evaluations').createIndex({ category: 1 });
  await db.collection('user_feedback').createIndex({ type: 1 });
  await db.collection('system_activity_log').createIndex({ event_type: 1, created_at: -1 });

  console.log('  All indexes created');
  console.log('\n  ⚠️  For Atlas Vector Search, create this index in Atlas UI:');
  console.log('  Index name: vector_index');
  console.log('  Type: vectorSearch');
  console.log('  Path: embedding');
  console.log('  Dimensions: 384');
  console.log('  Similarity: cosine');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 TrendLens AI v6.0 — MongoDB Seed Script');
  console.log(`   URI: ${MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  console.log(`   DB:  ${DB_NAME}`);
  console.log(`   Clean: ${CLEAN}\n`);

  const client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const db = client.db(DB_NAME);

    console.log('📦 Seeding collections...\n');
    await seedPosts(db);
    await seedGroundTruth(db);
    await seedEmbeddings(db);
    await seedModelRegistry(db);
    await seedDriftState(db);
    await seedTrendSnapshots(db);
    await seedEvaluations(db);
    await seedFeedback(db);
    await seedActivityLog(db);

    await createIndexes(db);

    console.log('\n✅ Seeding complete! TrendLens AI is ready to use.');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
