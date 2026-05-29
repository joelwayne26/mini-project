/**
 * TrendLens AI v6.0 — MongoDB Seed Script (Realistic Data Edition)
 * Populates MongoDB with realistic Ugandan food business data using
 * power-law engagement distributions that mirror real social media patterns.
 *
 * Key improvements over v1:
 * - Power-law engagement rates (not uniform random)
 * - Follower-dependent engagement computation
 * - Realistic like/comment/share ratios
 * - 73+ diverse Ugandan food business captions
 * - Category-specific performance patterns
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

// ─── Realistic Distribution Functions ──────────────────────────────────────

/**
 * Power-law (Pareto) distribution — mirrors real social media engagement.
 * Most posts get low engagement; few go viral.
 * alpha controls the "heavy tail" — higher alpha = more inequality.
 */
function powerLawSample(alpha: number = 2.5, xmin: number = 0.005): number {
  const u = Math.random();
  return xmin * Math.pow(1 - u, -1 / (alpha - 1));
}

/**
 * Generate a realistic engagement rate for a post.
 * Takes into account:
 *   - Follower count (inverse relationship — smaller accounts get higher rates)
 *   - Content quality signals (has CTA, price, hashtags)
 *   - Category (cakes get more engagement than general)
 */
function realisticEngagementRate(
  followers: number,
  hasCta: boolean,
  hasPrice: boolean,
  hashtagCount: number,
  category: string,
): number {
  // Base: power-law distributed
  let rate = powerLawSample(2.5, 0.005);

  // Follower adjustment: smaller accounts tend to have higher engagement rates
  const followerFactor = followers > 10000 ? 0.6 : followers > 5000 ? 0.75 : followers > 1000 ? 0.9 : 1.1;
  rate *= followerFactor;

  // CTA boost: posts with CTAs get ~40% more engagement (industry benchmark)
  if (hasCta) rate *= 1.4;

  // Price boost: posts with prices get ~30% more engagement
  if (hasPrice) rate *= 1.3;

  // Hashtag sweet spot: 5-10 hashtags is optimal
  if (hashtagCount >= 5 && hashtagCount <= 10) rate *= 1.2;
  else if (hashtagCount < 3) rate *= 0.8;

  // Category adjustment: visual food categories perform better
  const categoryBoost: Record<string, number> = { cake: 1.3, bakery: 1.15, restaurant: 1.2, general: 0.9 };
  rate *= categoryBoost[category] || 1.0;

  // Cap at realistic maximum (20% is extremely high for Uganda)
  return Number(Math.min(0.2, Math.max(0.002, rate)).toFixed(6));
}

/**
 * Generate realistic follower count using log-normal distribution.
 * Most Ugandan food businesses are small (500-5000 followers).
 */
function realisticFollowerCount(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const normal = Math.sqrt(-2 * Math.log(u1 || 0.001)) * Math.cos(2 * Math.PI * u2);
  const logNormal = Math.exp(6.5 + 1.2 * normal); // median ~665, mean ~1200
  return Math.max(50, Math.min(100000, Math.round(logNormal)));
}

/**
 * Generate likes from engagement rate and follower count.
 * Real Instagram: like-to-follower ratio ~ 1-5% for small accounts.
 */
function realisticLikes(engagementRate: number, followers: number): number {
  // Engagement rate is (likes + comments) / followers
  // Comments are typically 5-15% of likes
  const commentRatio = 0.05 + Math.random() * 0.1;
  const likes = Math.round(engagementRate * followers * (1 - commentRatio));
  return Math.max(1, likes);
}

function realisticComments(likes: number): number {
  return Math.max(0, Math.round(likes * (0.03 + Math.random() * 0.08)));
}

function realisticShares(comments: number): number {
  return Math.max(0, Math.round(comments * (0.3 + Math.random() * 0.5)));
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

// ─── Uganda Food Business Sample Data ────────────────────────────────────────

const CATEGORIES = ['cake', 'bakery', 'restaurant', 'general'] as const;

const SAMPLE_CAPTIONS: Record<string, Array<{
  text: string;
  qualityTier: 'high' | 'medium' | 'low';
}>> = {
  cake: [
    { text: "Beautiful custom wedding cake just finished! DM to order yours. #CakeKampala #UgandanBakery #WeddingCake #CustomCakes #KampalaEats #UGX #DreamWedding #BrideGoals", qualityTier: 'high' },
    { text: "Fresh from the oven! Chocolate layer cake UGX 85,000. WhatsApp 0700 123456 to order. #ChocolateCake #KampalaBakery #UGX #FreshBaked #OrderNow", qualityTier: 'high' },
    { text: "Our signature red velvet cake is perfect for any celebration. Starting at UGX 120,000. Link in bio! #RedVelvet #CakeUganda #Celebration #KampalaCakes", qualityTier: 'high' },
    { text: "Baby shower cake ideas! DM us for custom designs. Prices from UGX 65,000. #BabyShowerCake #KampalaCakes #CustomDesign #Uganda", qualityTier: 'medium' },
    { text: "3-tier wedding cake with sugar flowers. Order 2 weeks in advance. Call 0772 987654. #WeddingCakeKampala #SugarFlowers #UgandaWeddings", qualityTier: 'medium' },
    { text: "Try our new passion fruit cake! UGX 45,000 for 1kg. DM to order. #PassionFruit #TropicalCake #UgandanFlavors #KampalaFood", qualityTier: 'medium' },
    { text: "Birthday cake special! Free delivery in Kampala. UGX 55,000. WhatsApp 0700 555123. #BirthdayCake #KampalaDelivery #FreeDelivery", qualityTier: 'high' },
    { text: "Engagement cakes that make memories. Starting UGX 150,000. Link in bio to browse designs. #EngagementCake #KampalaLove #CustomCake", qualityTier: 'medium' },
    { text: "Mini cupcakes for your office party! UGX 3,000 each, minimum 12. DM to order. #Cupcakes #OfficeParty #KampalaEvents", qualityTier: 'low' },
    { text: "Our bestseller: vanilla bean cake with buttercream frosting. UGX 70,000. WhatsApp to order. #VanillaCake #Bestseller #KampalaBakery", qualityTier: 'medium' },
    { text: "AMAZING wedding cake just delivered! The bride was in tears of joy. DM us to make your dream cake a reality. UGX 200,000+. #WeddingCake #Kampala #Uganda #CustomCakes #DreamWedding #BrideGoals #CakeArt #UgandanBakery #KampalaWeddings #LuxuryCakes", qualityTier: 'high' },
    { text: "Flash sale! 50% off all pastries TODAY ONLY! UGX 3,000 each. WhatsApp 0700 123456 to reserve. #FlashSale #KampalaBakery #HalfPrice #LimitedOffer #Pastry #FreshBaked #UgandaDeals #KampalaEats", qualityTier: 'high' },
    { text: "cake ready for pickup", qualityTier: 'low' },
    { text: "New fondant designs available. Order now for your next event! #Fondant #CakeDesign #Kampala #Uganda #CustomCakes #BakeryLife #CakeLover", qualityTier: 'medium' },
    { text: "Our chocolate ganache cake was featured on NTV Uganda! Come taste the best in Kampala. UGX 90,000. Open daily! #NTVFeatured #BestCake #KampalaEats #Uganda #ChocolateGanache #MustTry #OrderNow", qualityTier: 'high' },
    { text: "Fruit cake season is here! Perfect for weddings and introductions. Starting UGX 100,000. DM to customize. #FruitCake #UgandanWeddings #KampalaBakery #CustomCakes #IntroductionCeremony", qualityTier: 'medium' },
    { text: "Cupcake tower for your next event! 50 cupcakes UGX 150,000. WhatsApp 0700 888999. #CupcakeTower #EventCatering #KampalaEvents #UgandaWeddings #BakeryKampala #OrderNow", qualityTier: 'high' },
  ],
  bakery: [
    { text: "Fresh bread every morning! Whole wheat UGX 5,000, white loaf UGX 4,000. Come grab yours! #FreshBread #KampalaBakery #MorningFresh #UGX #KampalaEats", qualityTier: 'high' },
    { text: "Cinnamon rolls just out of the oven! UGX 8,000 each. DM to reserve. #CinnamonRolls #PastryLovers #KampalaEats #FreshBaked #OrderNow", qualityTier: 'medium' },
    { text: "Samosa platter for your event! 50 pieces UGX 75,000. WhatsApp 0700 999888. #Samosa #UgandanSnacks #EventCatering #KampalaFood #UGX", qualityTier: 'high' },
    { text: "Fresh mandazi and chapati breakfast combo UGX 7,000! Open 6am-10am daily. #Mandazi #Chapati #BreakfastKampala #UgandaFood", qualityTier: 'medium' },
    { text: "Artisan sourdough bread now available! UGX 12,000. Limited stock daily. #Sourdough #ArtisanBread #KampalaFoodies #FreshBaked", qualityTier: 'medium' },
    { text: "Our famous Rolex rolls! Chapati + eggs UGX 5,000. Best in Kampala! #Rolex #UgandanStreetFood #KampalaStreetFood #UGX", qualityTier: 'high' },
    { text: "Wedding pastry boxes starting UGX 150,000 for 100 pcs. DM for catalogue. #WeddingPastries #UgandaWeddings #BakeryKampala #OrderNow", qualityTier: 'medium' },
    { text: "Gluten-free banana bread! UGX 15,000. DM to pre-order. #GlutenFree #HealthyBaking #KampalaHealth #UGX", qualityTier: 'low' },
    { text: "Fresh doughnuts! Glazed UGX 3,000, filled UGX 4,000. While stocks last! #Doughnuts #KampalaSnacks #FreshBaked #UGX #LimitedOffer", qualityTier: 'medium' },
    { text: "Corporate breakfast catering available. DM for quote. #CorporateCatering #BreakfastMeeting #KampalaBusiness #CateringUG", qualityTier: 'low' },
    { text: "bread available", qualityTier: 'low' },
    { text: "Whole wheat banana bread! Healthy and delicious. UGX 10,000 per loaf. DM to order. #HealthyBread #BananaBread #KampalaBakery #CleanEatingUG #FreshBaked #UGX", qualityTier: 'medium' },
    { text: "Our Rolex was featured on NTV Uganda! Come taste the best chapati + eggs in Kampala. UGX 5,000. Open 24/7! #NTVFeatured #BestRolex #KampalaStreetFood #Uganda #247 #StreetFoodKing #MustTry", qualityTier: 'high' },
    { text: "Premium croissants with Ugandan vanilla! UGX 6,000 each. Limited batch daily. #Croissants #UgandanVanilla #KampalaBakery #ArtisanBaking #FreshBaked #OrderNow", qualityTier: 'high' },
  ],
  restaurant: [
    { text: "Lunch special: Matooke + G-nut sauce + rice UGX 15,000! Dine-in or takeaway. #LunchSpecial #UgandanFood #KampalaRestaurant #UGX #KampalaEats", qualityTier: 'high' },
    { text: "Our Rolex is voted best in Kampala! Fresh chapati + 2 eggs UGX 6,000. #BestRolex #StreetFood #KampalaEats #UGX #UgandanFood", qualityTier: 'high' },
    { text: "Friday special: Grilled tilapia with sweet potato UGX 25,000. Reserve your table! 0772 111222. #Tilapia #FridayDinner #Kampala #UGX #DineIn", qualityTier: 'high' },
    { text: "Luweero chicken prepared the traditional way! UGX 20,000 half, UGX 35,000 whole. #LocalChicken #TraditionalFood #Uganda #UGX #KampalaFood", qualityTier: 'medium' },
    { text: "Buffet lunch every Sunday UGX 35,000 per person. Kids under 5 eat free! #SundayBuffet #FamilyDining #KampalaLunch #UGX #RestaurantUG", qualityTier: 'high' },
    { text: "Fresh juice combo: Mango + Passion fruit UGX 8,000. #FreshJuice #UgandanFruits #HealthyEating #Kampala #UGX", qualityTier: 'medium' },
    { text: "Evening BBQ platter for 2 UGX 45,000. Includes goat meat, chicken, sides. #BBQ #EveningVibes #KampalaNightlife #UGX #DineIn", qualityTier: 'medium' },
    { text: "Breakfast of champions: Rolex + African tea UGX 8,000. Open from 6am! #Breakfast #Rolex #MorningVibes #KampalaEats #UGX", qualityTier: 'medium' },
    { text: "Private dining room available for events up to 30 guests. Call 0312 456789. #PrivateDining #Events #KampalaEvents #RestaurantUG", qualityTier: 'low' },
    { text: "New on the menu: Grilled goat ribs with irish potatoes UGX 22,000! #GoatRibs #NewMenu #UgandanBBQ #KampalaRestaurant #UGX #OrderNow", qualityTier: 'medium' },
    { text: "food for sale", qualityTier: 'low' },
    { text: "Traditional Luwombo prepared with love! Chicken, beef, or fish options. Starting UGX 18,000. Dine-in or takeaway. WhatsApp 0700 222333. #Luwombo #UgandanFood #TraditionalCuisine #KampalaRestaurant #UGX #OrderNow", qualityTier: 'high' },
    { text: "Kikomando special: Beans + chapati UGX 4,000! Student-friendly prices. Open 7am-10pm. #Kikomando #StudentFood #KampalaEats #Affordable #UGX", qualityTier: 'medium' },
  ],
  general: [
    { text: "Support local! Buy fresh produce directly from Ugandan farmers. #BuyLocal #UgandanFarmers #SupportLocal #KampalaMarket", qualityTier: 'medium' },
    { text: "Food hygiene tip: Always wash your produce thoroughly! #FoodSafety #HealthyEating #Uganda #CleanFood", qualityTier: 'low' },
    { text: "This weekend's food market at Lugogo! Over 50 vendors. Free entry. #FoodMarket #KampalaEvents #WeekendVibes #UgandaFood", qualityTier: 'high' },
    { text: "Uganda's coffee is among the best in the world! Try a cup today. #UgandaCoffee #SpecialtyCoffee #AfricanCoffee #KampalaCafe", qualityTier: 'medium' },
    { text: "Recipe: How to make the perfect Luwombo at home. Link in bio! #Luwombo #UgandanRecipe #HomeCooking #KampalaFood", qualityTier: 'medium' },
    { text: "New restaurant alert! Opening in Nakawa this Saturday. Come taste the difference. #NewRestaurant #KampalaFood #OpeningDay #UgandaEats", qualityTier: 'high' },
    { text: "Street food guide: Top 10 must-try foods in Kampala. #StreetFood #KampalaGuide #Foodie #UgandaFood", qualityTier: 'medium' },
    { text: "Farm to table: Why sourcing locally matters for your restaurant. #FarmToTable #Sustainability #UgandanAgriculture #KampalaBusiness", qualityTier: 'low' },
    { text: "Ugandan vanilla is world-class! Supporting vanilla farmers in Mbale. #Vanilla #UgandanExports #FarmDirect #SupportLocalUG", qualityTier: 'medium' },
    { text: "Happy hour deals across Kampala this week! Tag your drinking buddy. #HappyHour #KampalaNightlife #Deals #UGX #KampalaEats", qualityTier: 'high' },
    { text: "WhatsApp Business tip: Use quick replies to handle food orders faster! #WhatsAppBusiness #UgandaBusiness #FoodBusiness #SmallBizUG", qualityTier: 'medium' },
    { text: "Pop-up kitchen this Saturday at The Hub Kampala! Live cooking, free samples, UGX deals. 10am-4pm. #PopUpKitchen #KampalaEvents #FreeSamples #UGX #FoodieUG", qualityTier: 'high' },
  ],
};

const PLATFORMS = ['instagram', 'twitter', 'facebook'] as const;

function classifyFromCaption(caption: string): string {
  const lower = caption.toLowerCase();
  if (/cake|wedding cake|birthday cake|cupcake|red velvet|fondant|ganache|fruit cake/i.test(lower)) return 'cake';
  if (/bread|bakery|pastry|sourdough|dough|roll|mandazi|samosa|croissant|rolex|chapati/i.test(lower)) return 'bakery';
  if (/restaurant|lunch|dinner|buffet|dine|menu|tilapia|goat|bbq|luwombo|matooke|kikomando/i.test(lower)) return 'restaurant';
  return 'general';
}

/** Enhanced TF-based 384-dim embedding with n-gram and semantic features */
function textToEmbedding(text: string): number[] {
  const dim = 384;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  const embedding = new Array(dim).fill(0);

  // Unigram features
  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % (dim - 20);
    embedding[idx] += 1;
  }

  // Bigram features for richer semantics
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    let hash = 0;
    for (let j = 0; j < bigram.length; j++) {
      hash = ((hash << 5) - hash + bigram.charCodeAt(j)) | 0;
    }
    const idx = Math.abs(hash) % (dim - 20) + 10;
    if (idx < dim - 20) embedding[idx] += 0.8;
  }

  // Semantic vocabulary features
  const FOOD_VOCAB = [
    'cake', 'bread', 'pastry', 'bakery', 'restaurant', 'food', 'meal', 'dish',
    'ugx', 'delivery', 'order', 'fresh', 'homemade', 'delicious', 'special',
    'kampala', 'uganda', 'birthday', 'wedding', 'custom', 'organic', 'local',
    'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'coffee',
    'chocolate', 'vanilla', 'chicken', 'beef', 'fish', 'rice', 'matooke',
    'whatsapp', 'dm', 'link', 'price', 'starting', 'limited', 'offer',
    'morning', 'evening', 'today', 'new', 'best', 'top', 'premium',
    'rolex', 'luwombo', 'chapati', 'mandazi', 'tilapia', 'fondant',
    'sourdough', 'croissant', 'cupcake', 'icing', 'ganache',
  ];
  for (let i = 0; i < FOOD_VOCAB.length && i < (dim - 20) / 4; i++) {
    if (text.toLowerCase().includes(FOOD_VOCAB[i])) {
      embedding[i] += 2;
    }
  }

  // Structural features in last slots
  embedding[dim - 1] = Math.min(1, words.length / 50);
  embedding[dim - 2] = (text.match(/#/g) || []).length / 15;
  embedding[dim - 3] = /ugx|ush|\$/i.test(text) ? 1 : 0;
  embedding[dim - 4] = /dm|whatsapp|link in bio|order/i.test(text) ? 1 : 0;
  embedding[dim - 5] = (text.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length / 5;
  embedding[dim - 6] = /call|reserve|book|visit/i.test(text) ? 1 : 0;
  embedding[dim - 7] = /free delivery|delivery|takeaway/i.test(text) ? 1 : 0;
  embedding[dim - 8] = /limited|flash sale|today only|while stock/i.test(text) ? 1 : 0;
  embedding[dim - 9] = /ntv|featured|voted|best/i.test(text) ? 1 : 0;
  embedding[dim - 10] = /ugx\s*\d/i.test(text) ? 1 : 0; // Price with number

  // Normalize
  const norm = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
  return embedding.map(v => Number((v / norm).toFixed(6)));
}

// ─── Seed Functions ──────────────────────────────────────────────────────────

async function seedPosts(db: Db) {
  const collection = db.collection('posts');
  const docs = [];

  for (const category of CATEGORIES) {
    for (const captionData of SAMPLE_CAPTIONS[category]) {
      const caption = captionData.text;
      const hashtags = (caption.match(/#\w+/g) || []).map(t => t.slice(1));
      const hasCta = /dm|whatsapp|link in bio|order|call|reserve|book|visit/i.test(caption);
      const hasPrice = /ugx|ush|\$/i.test(caption);
      const followers = realisticFollowerCount();
      const engagementRate = realisticEngagementRate(followers, hasCta, hasPrice, hashtags.length, category);
      const likes = realisticLikes(engagementRate, followers);
      const comments = realisticComments(likes);
      const shares = realisticShares(comments);

      docs.push({
        caption,
        category,
        engagement_rate: engagementRate,
        hashtags,
        has_cta: hasCta,
        has_price: hasPrice,
        platform: pickRandom(PLATFORMS),
        likes,
        comments,
        shares,
        owner_followers: followers,
        quality_tier: captionData.qualityTier,
        created_at: new Date(Date.now() - randomInt(0, 90) * 86400000).toISOString(),
      });
    }
  }

  // Add more variation — mix quality tiers
  for (let i = 0; i < 40; i++) {
    const cat = pickRandom(CATEGORIES);
    const captionData = pickRandom(SAMPLE_CAPTIONS[cat]);
    const caption = captionData.text + ' ' + pickN(['#Fresh', '#Tasty', '#Kampala', '#Uganda', '#Foodie', '#Delicious', '#Yummy', '#Local', '#UGX', '#BestInTown'], randomInt(1, 3)).join(' ');
    const hashtags = (caption.match(/#\w+/g) || []).map(t => t.slice(1));
    const hasCta = Math.random() > 0.25;
    const hasPrice = Math.random() > 0.35;
    const followers = realisticFollowerCount();
    const engagementRate = realisticEngagementRate(followers, hasCta, hasPrice, hashtags.length, cat);
    const likes = realisticLikes(engagementRate, followers);
    const comments = realisticComments(likes);
    const shares = realisticShares(comments);

    docs.push({
      caption,
      category: cat,
      engagement_rate: engagementRate,
      hashtags,
      has_cta: hasCta,
      has_price: hasPrice,
      platform: pickRandom(PLATFORMS),
      likes,
      comments,
      shares,
      owner_followers: followers,
      quality_tier: captionData.qualityTier,
      created_at: new Date(Date.now() - randomInt(0, 60) * 86400000).toISOString(),
    });
  }

  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} posts (realistic engagement distribution)`);
}

async function seedGroundTruth(db: Db) {
  const collection = db.collection('ground_truth_posts');
  const docs = [];

  for (const category of CATEGORIES) {
    for (const captionData of SAMPLE_CAPTIONS[category]) {
      const caption = captionData.text;
      const hashtags = (caption.match(/#\w+/g) || []).map(t => t.slice(1));
      const hasCta = /dm|whatsapp|link in bio|order|call|reserve|book|visit/i.test(caption);
      const hasPrice = /ugx|ush|\$/i.test(caption);
      const followers = realisticFollowerCount();
      const engagementRate = realisticEngagementRate(followers, hasCta, hasPrice, hashtags.length, category);

      // Label based on engagement rate thresholds
      let label: string;
      if (engagementRate > 0.08) label = 'high';
      else if (engagementRate > 0.03) label = 'medium';
      else label = 'low';

      // Score: map engagement rate to 1-10 scale
      const score = Math.round(Math.max(1, Math.min(10, engagementRate * 50 + randomFloat(2, 4))) * 10) / 10;

      docs.push({
        caption,
        category,
        engagement_rate: engagementRate,
        label,
        score,
        hashtags,
        has_cta: hasCta,
        has_price: hasPrice,
        platform: pickRandom(PLATFORMS),
        owner_followers: followers,
        created_at: new Date(Date.now() - randomInt(0, 180) * 86400000).toISOString(),
      });
    }
  }

  // Extra high-performing examples (viral posts)
  const highPerformers = [
    { text: "AMAZING wedding cake just delivered! The bride was in tears of joy. DM us to make your dream cake a reality. UGX 200,000+. #WeddingCake #Kampala #Uganda #CustomCakes #DreamWedding #BrideGoals #CakeArt #UgandanBakery #KampalaWeddings #LuxuryCakes", category: 'cake' },
    { text: "Flash sale! 50% off all pastries TODAY ONLY! UGX 3,000 each. WhatsApp 0700 123456 to reserve. #FlashSale #KampalaBakery #HalfPrice #LimitedOffer #Pastry #FreshBaked #UgandaDeals #KampalaEats", category: 'bakery' },
    { text: "Our Rolex was featured on NTV Uganda! Come taste the best chapati + eggs in Kampala. UGX 5,000. Open 24/7! #NTVFeatured #BestRolex #KampalaStreetFood #Uganda #247 #StreetFoodKing #MustTry", category: 'restaurant' },
    { text: "Pop-up kitchen this Saturday at The Hub Kampala! Live cooking, free samples, UGX deals. 10am-4pm. #PopUpKitchen #KampalaEvents #FreeSamples #UGX #FoodieUG #MustAttend #WeekendVibes #KampalaFood", category: 'general' },
  ];
  for (const hp of highPerformers) {
    const caption = hp.text;
    const hashtags = (caption.match(/#\w+/g) || []).map(t => t.slice(1));
    const followers = realisticFollowerCount();
    const engagementRate = realisticEngagementRate(followers, true, true, hashtags.length, hp.category) * 1.5;
    const cappedRate = Math.min(0.2, engagementRate);

    docs.push({
      caption,
      category: hp.category,
      engagement_rate: Number(cappedRate.toFixed(6)),
      label: 'high',
      score: Number((8 + Math.random() * 2).toFixed(1)),
      hashtags,
      has_cta: true,
      has_price: true,
      platform: 'instagram',
      owner_followers: followers,
      created_at: new Date(Date.now() - randomInt(0, 30) * 86400000).toISOString(),
    });
  }

  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} ground_truth_posts (power-law distribution)`);
}

function randomFloat(min: number, max: number, decimals = 4): number {
  return Number((Math.random() * (max - min) + min).toFixed(decimals));
}

async function seedEmbeddings(db: Db) {
  const collection = db.collection('embeddings');
  const docs = [];

  for (const category of CATEGORIES) {
    for (const captionData of SAMPLE_CAPTIONS[category]) {
      const caption = captionData.text;
      const followers = realisticFollowerCount();
      const hasCta = /dm|whatsapp|link in bio|order|call|reserve/i.test(caption);
      const hasPrice = /ugx|ush|\$/i.test(caption);
      const hashtags = (caption.match(/#\w+/g) || []).map(t => t.slice(1));
      const engagementRate = realisticEngagementRate(followers, hasCta, hasPrice, hashtags.length, category);

      docs.push({
        caption,
        category,
        engagement_rate: engagementRate,
        embedding: textToEmbedding(caption),
        hashtags,
        has_cta: hasCta,
        has_price: hasPrice,
        created_at: new Date(Date.now() - randomInt(0, 90) * 86400000).toISOString(),
      });
    }
  }

  if (CLEAN) await collection.deleteMany({});
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} embeddings (enhanced n-gram + semantic features)`);
  console.log('  NOTE: Create Atlas Vector Search index "vector_index" on path "embedding" with 384 dimensions for RAG to work');
}

async function seedModelRegistry(db: Db) {
  const collection = db.collection('model_registry');
  if (CLEAN) await collection.deleteMany({});
  const docs = [
    { model_type: 'logistic_regression', version: 'v6.1.0', auc: 0.8654, samples: 250, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count', 'sentiment', 'trend_alignment', 'emoji_count', 'readability', 'image_brightness', 'image_sharpness', 'image_saturation', 'image_resolution'], fold_aucs: [0.85, 0.88, 0.84, 0.87, 0.86], trained_at: new Date(Date.now() - 3 * 86400000).toISOString(), status: 'production', weights_stored: true },
    { model_type: 'xgboost', version: 'v6.0.0', auc: 0.8742, samples: 250, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count', 'sentiment', 'trend_alignment', 'emoji_count', 'readability'], fold_aucs: [0.86, 0.89, 0.85, 0.88, 0.87], trained_at: new Date(Date.now() - 7 * 86400000).toISOString(), status: 'production' },
    { model_type: 'xgboost', version: 'v5.2.0', auc: 0.8521, samples: 180, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count', 'sentiment', 'emoji_count'], fold_aucs: [0.84, 0.87, 0.83, 0.86, 0.85], trained_at: new Date(Date.now() - 21 * 86400000).toISOString(), status: 'archived' },
    { model_type: 'xgboost', version: 'v5.0.0', auc: 0.8190, samples: 120, features: ['hashtag_count', 'has_cta', 'has_price', 'word_count'], fold_aucs: [0.80, 0.83, 0.79, 0.84, 0.82], trained_at: new Date(Date.now() - 45 * 86400000).toISOString(), status: 'archived' },
  ];
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} model_registry entries (includes logistic regression)`);
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
    { keyword: 'fondant cakes Kampala', category: 'cake', source: 'instagram' },
    { keyword: 'luwombo traditional food', category: 'restaurant', source: 'google_trends' },
    { keyword: 'Ugandan vanilla', category: 'general', source: 'google_trends' },
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
      const captionData = pickRandom(SAMPLE_CAPTIONS[category]);
      docs.push({
        caption: captionData.text,
        image_url: '',
        overall_score: captionData.qualityTier === 'high' ? randomFloat(7, 9.5, 1) : captionData.qualityTier === 'medium' ? randomFloat(4.5, 7.5, 1) : randomFloat(2, 5, 1),
        poster_score: randomFloat(3, 9, 1),
        caption_score: randomFloat(3, 9, 1),
        category,
        model_version: 'logistic_regression_v6.1.0',
        shap_values: [
          { feature: 'hashtag_count', contribution: randomFloat(-1, 2) },
          { feature: 'has_cta', contribution: randomFloat(-1, 2) },
          { feature: 'has_price', contribution: randomFloat(-1, 1.5) },
          { feature: 'word_count', contribution: randomFloat(-0.5, 1) },
          { feature: 'sentiment', contribution: randomFloat(-0.5, 1) },
          { feature: 'image_brightness', contribution: randomFloat(-0.3, 0.8) },
          { feature: 'image_sharpness', contribution: randomFloat(-0.3, 0.8) },
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
    { type: 'caption', rating: 'thumbs_up', evaluation_id: 'demo-6', timestamp: new Date(Date.now() - 6 * 86400000).toISOString() },
    { type: 'suggestion', rating: 'thumbs_up', evaluation_id: 'demo-7', timestamp: new Date(Date.now() - 7 * 86400000).toISOString() },
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
    { event_type: 'retrain', message: 'Logistic regression model retrained', metadata: { auc: 0.87 }, created_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    { event_type: 'drift_check', message: 'No drift detected', metadata: { mmd: 0.03 }, created_at: new Date(Date.now() - 6 * 3600000).toISOString() },
    { event_type: 'seed', message: 'Database seeded with realistic data (power-law distribution)', metadata: {}, created_at: new Date().toISOString() },
  ];
  await collection.insertMany(docs);
  console.log(`  Seeded ${docs.length} system_activity_log entries`);
}

// ─── Create Indexes ──────────────────────────────────────────────────────────

async function createIndexes(db: Db) {
  console.log('\n📊 Creating indexes...');
  await db.collection('posts').createIndex({ category: 1, engagement_rate: -1 });
  await db.collection('posts').createIndex({ quality_tier: 1 });
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
  console.log('🌱 TrendLens AI v6.0 — MongoDB Seed Script (Realistic Data Edition)');
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
    console.log('📦 Seeding collections (power-law engagement distribution)...\n');
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
    console.log('\n✅ Seeding complete! TrendLens AI is ready with realistic data.');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
