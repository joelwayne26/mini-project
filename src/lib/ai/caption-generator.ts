/**
 * TrendLens AI v6.0 — Local Caption Generator
 * Template-based NLG with intelligent composition — NO external LLM APIs.
 * Generates creative, contextually-aware captions for Ugandan food businesses.
 *
 * v2: Fixes illogical trend injection and respects visual analysis
 * for CTA/price detection from poster images.
 */

import { CaptionFeatures } from './types';
import { getCategoryRule, CATEGORY_RULES } from './category-rules';

// ─── Pattern Library ───────────────────────────────────────────────────────

interface CaptionPattern {
  openings: string[];
  descriptions: string[];
  benefits: string[];
  ctas: string[];
  hashtagSets: Record<string, string[]>;
  emojiSets: string[];
}

const PATTERNS: Record<string, CaptionPattern> = {
  cake: {
    openings: [
      'Indulge in', 'Treat yourself to', 'Celebrate with', 'Make their day with',
      'Say yes to', 'Fall in love with', 'Your special day deserves',
    ],
    descriptions: [
      'our handcrafted {item}', 'a masterpiece of flavor', 'the finest {item} in town',
      'our signature {item}', 'something truly special', 'a work of edible art',
    ],
    benefits: [
      'Made with premium ingredients and lots of love',
      'Every bite is a celebration',
      'Custom designs to match your vision',
      'Fresh baked, never frozen',
      'We deliver right to your door',
    ],
    ctas: [
      'DM to order yours today!',
      'WhatsApp 0700 XXX XXX to place your order',
      'Link in bio to customize your cake',
      'Order now and make your celebration unforgettable',
      'Limited slots available, book yours now!',
    ],
    hashtagSets: {
      core: ['#CakeKampala', '#UgandanBakery', '#CustomCakesUG', '#CakeLover'],
      type: ['#WeddingCake', '#BirthdayCake', '#Cupcakes', '#FondantCake'],
      local: ['#KampalaFood', '#UgandaFood', '#KampalaEats', '#UGFoodie'],
    },
    emojiSets: ['🎂🍰🧁', '✨🎉💕', '🤤😋🔥', '💝🎂✨'],
  },
  bakery: {
    openings: [
      'Fresh from the oven', 'Start your morning with', 'Warm, crusty, perfect',
      'There\'s nothing like', 'The aroma of', 'Rise and shine with',
    ],
    descriptions: [
      'our artisan {item}', 'freshly baked {item}', 'our signature {item}',
      'the best {item} in Kampala', 'golden, flaky {item}',
    ],
    benefits: [
      'Baked fresh every single morning',
      'Made with the finest flour and ingredients',
      'Your neighborhood bakery since day one',
      'From our oven to your table',
    ],
    ctas: [
      'Visit us today or DM to order!',
      'WhatsApp 0700 XXX XXX for bulk orders',
      'Link in bio for our full menu',
      'Early bird gets the freshest bread!',
    ],
    hashtagSets: {
      core: ['#KampalaBakery', '#FreshBreadUG', '#ArtisanBaking', '#BakeryLife'],
      type: ['#Sourdough', '#Croissant', '#Pastries', '#FreshBread'],
      local: ['#KampalaFood', '#UgandaEats', '#UGBreakfast', '#KlaFoodie'],
    },
    emojiSets: ['🥖🍞🥐', '☀️☕🥐', '🔥😋🥖', '💛✨🍞'],
  },
  restaurant: {
    openings: [
      'Craving something delicious?', 'Your taste buds will thank you for',
      'Experience the flavors of', 'Satisfy your hunger with',
      'Tonight\'s special is', 'Come hungry, leave happy with',
    ],
    descriptions: [
      'our mouthwatering {item}', 'the perfect {item}', 'our chef\'s special {item}',
      'a plate full of flavor', 'our legendary {item}',
    ],
    benefits: [
      'Generous portions, honest prices',
      'Made with locally sourced ingredients',
      'A taste you won\'t find anywhere else',
      'Perfect for family dining',
    ],
    ctas: [
      'Reserve your table, DM or call!',
      'WhatsApp 0700 XXX XXX for delivery',
      'Tag someone who needs to try this',
      'Link in bio for our full menu',
    ],
    hashtagSets: {
      core: ['#KampalaRestaurant', '#UGFoodie', '#KlaDining', '#UgandaEats'],
      type: ['#LocalFood', '#FoodLover', '#UGFood', '#KampalaEats'],
      local: ['#UgandanFood', '#EastAfricanFood', '#KlaNightlife', '#UGDining'],
    },
    emojiSets: ['🍽️🥘🔥', '😋👨‍🍳✨', '🤤🍗🌶️', '❤️🍴🥂'],
  },
  general: {
    openings: [
      'Introducing', 'Check out', 'You\'ll love', 'Don\'t miss',
      'Something special is here', 'Elevate your game with',
    ],
    descriptions: [
      'our amazing {item}', 'something you\'ve been waiting for', 'the best in town',
      'quality you can trust', 'a game-changer',
    ],
    benefits: [
      'Quality that speaks for itself',
      'Designed with you in mind',
      'Supporting local businesses',
      'Proudly made in Uganda',
    ],
    ctas: [
      'DM to order!',
      'WhatsApp us at 0700 XXX XXX',
      'Link in bio for details',
      'Limited stock, order now!',
    ],
    hashtagSets: {
      core: ['#KampalaBusiness', '#SupportLocalUG', '#Uganda', '#MadeInUG'],
      type: ['#Quality', '#SmallBusiness', '#LocalFirst', '#ShopLocal'],
      local: ['#Kampala', '#UgandaLife', '#UGBusiness', '#KlaHustle'],
    },
    emojiSets: ['✨🔥💯', '💪🇺🇬❤️', '🎯⭐💫', '🚀💯❤️'],
  },
};

// ─── Trend Keyword Filtering ───────────────────────────────────────────────

/**
 * Filter out irrelevant, non-food-related, or low-quality trend keywords.
 * Prevents injecting news headlines or unrelated topics into food captions.
 */
function isRelevantFoodTrend(keyword: string): boolean {
  const lower = keyword.toLowerCase().trim();

  // Too long (likely a news headline, not a trend)
  if (lower.length > 40) return false;

  // Contains news headline patterns
  const headlinePatterns = [
    /^(the\s+\d+|top\s+\d+|best\s+\d+|how\s+to|why\s+|what\s+|when\s+|who\s+|where\s+)/i,
    /(rising women|daily monitor|new vision|observer|daily monito)/i,
    /\.{3}/,  // Ellipsis = headline snippet
    /-\s*(daily|monitor|vision|observer|reporter|news)/i,  // News source attribution
  ];
  for (const pattern of headlinePatterns) {
    if (pattern.test(lower)) return false;
  }

  // Must contain at least one food/business-related word
  const foodWords = [
    'food', 'cake', 'bread', 'bakery', 'restaurant', 'kampala', 'uganda', 'ugx',
    'lunch', 'dinner', 'breakfast', 'delivery', 'order', 'fresh', 'recipe',
    'chicken', 'beef', 'fish', 'rice', 'pizza', 'burger', 'coffee', 'tea',
    'pastry', 'dessert', 'sweet', 'spicy', 'grill', 'rolex', 'matooke',
    'luwombo', 'pilau', 'chapati', 'mandazi', 'rolex', 'organic', 'healthy',
    'meal', 'dish', 'cook', 'chef', 'menu', 'taste', 'delicious', 'yummy',
    'wedding', 'birthday', 'celebration', 'custom', 'artisan', 'homemade',
    'local', 'business', 'market', 'deal', 'offer', 'price', 'discount',
    'whatsapp', 'dm', 'shop', 'buy', 'sell', 'brand', 'quality',
  ];
  const hasFoodWord = foodWords.some(w => lower.includes(w));
  if (!hasFoodWord) return false;

  return true;
}

/**
 * Clean and format trend keywords for caption injection.
 * Only injects keywords that are relevant food trends.
 */
function cleanTrendKeywords(keywords: string[]): string[] {
  return keywords
    .filter(isRelevantFoodTrend)
    .map(kw => kw.trim())
    .filter(kw => kw.length > 3 && kw.length <= 35);
}

// ─── Caption Generator ─────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function detectItemFromCaption(caption: string, category: string): string {
  const lower = caption.toLowerCase();
  const itemMap: Record<string, string[]> = {
    cake: ['chocolate cake', 'vanilla cake', 'red velvet', 'birthday cake', 'wedding cake', 'cupcake', 'cheesecake', 'black forest', 'cake'],
    bakery: ['sourdough', 'croissant', 'bread', 'pastry', 'baguette', 'muffin', 'danish', 'cinnamon roll', 'donut'],
    restaurant: ['rolex', 'matooke', 'luwombo', 'pilau', 'kikomando', 'grilled chicken', 'fish', 'beef stew', 'rice and beans'],
    general: [],
  };
  const items = itemMap[category] || [];
  for (const item of items) {
    if (lower.includes(item)) return item;
  }
  return category === 'general' ? 'product' : category === 'cake' ? 'cake' : category === 'bakery' ? 'bread' : 'dish';
}

/**
 * Extended features that include visual analysis results.
 * This allows the caption generator to know about CTA/price
 * detected on the poster image, not just in the caption text.
 */
interface ExtendedCaptionFeatures extends CaptionFeatures {
  /** CTA detected on the poster image (from visual analysis) */
  visualCtaDetected?: boolean;
  visualCtaText?: string;
  /** Price detected on the poster image (from visual analysis) */
  visualPriceDetected?: boolean;
  visualPriceText?: string;
}

export function generateImprovedCaption(
  originalCaption: string,
  features: CaptionFeatures,
  category: string,
  trendKeywords: string[] = [],
  topHashtags: string[] = [],
  visualAnalysis?: {
    visualCtaDetected?: boolean;
    visualCtaText?: string;
    visualPriceDetected?: boolean;
    visualPriceText?: string;
  } | null,
): string {
  if (!originalCaption.trim()) {
    return generateCaptionFromScratch(category, trendKeywords, topHashtags);
  }

  const rules = getCategoryRule(category);
  const pattern = PATTERNS[category] || PATTERNS.general;
  const item = detectItemFromCaption(originalCaption, category);
  const parts: string[] = [];

  // Determine effective CTA/price (combining caption + visual analysis)
  const effectiveHasCta = features.hasCta || (visualAnalysis?.visualCtaDetected ?? false);
  const effectiveHasPrice = features.hasPrice || (visualAnalysis?.visualPriceDetected ?? false);

  // 1. Keep and enhance the original opening (always preserve user's voice)
  const sentences = originalCaption.split(/[.!]/).filter(s => s.trim().length > 0);
  if (sentences.length > 0) {
    const firstSentence = sentences[0].trim();
    // Capitalize first letter if needed
    const enhanced = firstSentence.charAt(0).toUpperCase() + firstSentence.slice(1);
    parts.push(enhanced + (firstSentence.endsWith('!') ? '' : '!'));
  } else {
    parts.push(pick(pattern.openings) + ' ' + pick(pattern.descriptions).replace('{item}', item) + '!');
  }

  // 2. Add more from the original caption (preserve their message)
  if (sentences.length > 1) {
    // Add remaining original sentences, cleaned up
    const rest = sentences.slice(1).map(s => s.trim()).filter(s => s.length > 5 && !s.match(/^#\w+$/));
    if (rest.length > 0) {
      parts.push(rest.join('. ') + '.');
    }
  }

  // 3. Price mention — only if NOT already present (in caption OR on image)
  if (!effectiveHasPrice) {
    const pricePhrases = ['Starting at UGX 50,000', 'Prices from UGX 30,000', 'Affordable luxury from UGX 25,000'];
    parts.push(pick(pricePhrases));
  } else if (visualAnalysis?.visualPriceText && !features.hasPrice) {
    // Price is on the image but not in caption — mention it in text too for better SEO
    parts.push(`${visualAnalysis.visualPriceText}`);
  }

  // 4. Benefit — only if caption is short
  if (features.wordCount < 40) {
    parts.push(pick(pattern.benefits) + '.');
  }

  // 5. Trend keyword injection — ONLY relevant food trends, NEVER news headlines
  const cleanKeywords = cleanTrendKeywords(trendKeywords);
  if (cleanKeywords.length > 0 && features.trendAlignment.score < 0.2) {
    // Use hashtag-style trend mention instead of raw text injection
    parts.push(`Join the ${cleanKeywords[0]} trend!`);
  }

  // 6. CTA — only if NOT already present (in caption OR on image)
  if (!effectiveHasCta) {
    parts.push(pick(pattern.ctas));
  } else if (visualAnalysis?.visualCtaText && !features.hasCta) {
    // CTA is on the image but not in caption — add it to text for accessibility
    parts.push(visualAnalysis.visualCtaText);
  }

  // 7. Emojis — only if none present
  const hasEmojis = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(originalCaption);
  if (!hasEmojis) {
    parts.push(pick(pattern.emojiSets));
  }

  // 8. Hashtags — merge original + recommended
  const existingHashtags = (originalCaption.match(/#\w+/g) || []).map(h => h.toLowerCase());
  const neededCount = Math.max(0, rules.idealHashtags - existingHashtags.length);
  const newHashtags: string[] = [];

  // Add top-performing hashtags from DB first (most relevant)
  for (const tag of topHashtags.slice(0, 5)) {
    if (newHashtags.length >= neededCount) break;
    const formatted = tag.startsWith('#') ? tag : `#${tag}`;
    if (!existingHashtags.includes(formatted.toLowerCase()) && !newHashtags.includes(formatted)) {
      newHashtags.push(formatted);
    }
  }

  // Fill remaining with category-specific hashtags
  for (const [_, tags] of Object.entries(pattern.hashtagSets)) {
    for (const tag of tags) {
      if (newHashtags.length >= neededCount) break;
      if (!existingHashtags.includes(tag.toLowerCase()) && !newHashtags.includes(tag)) {
        newHashtags.push(tag);
      }
    }
  }

  const allHashtags = [...existingHashtags.map(h => h.startsWith('#') ? h : `#${h}`), ...newHashtags];
  if (allHashtags.length > 0) {
    parts.push('\n\n' + allHashtags.join(' '));
  }

  return parts.join(' ').replace(/\n{3,}/g, '\n\n').trim();
}

function generateCaptionFromScratch(
  category: string,
  trendKeywords: string[],
  topHashtags: string[],
): string {
  const pattern = PATTERNS[category] || PATTERNS.general;
  const rules = getCategoryRule(category);
  const item = category === 'cake' ? 'cake' : category === 'bakery' ? 'fresh bread' : category === 'restaurant' ? 'dish' : 'product';

  const parts: string[] = [];

  // Opening
  parts.push(`${pick(pattern.openings)} ${pick(pattern.descriptions).replace('{item}', item)}!`);

  // Benefit
  parts.push(pick(pattern.benefits) + '.');

  // Trend — only relevant food keywords
  const cleanKeywords = cleanTrendKeywords(trendKeywords);
  if (cleanKeywords.length > 0) {
    parts.push(`Join the ${cleanKeywords[0]} trend!`);
  }

  // Price
  if (rules.priceRequired) {
    parts.push('Starting at UGX 50,000.');
  }

  // CTA
  parts.push(pick(pattern.ctas));

  // Emojis
  parts.push(pick(pattern.emojiSets));

  // Hashtags
  const allTags: string[] = [];
  for (const tags of Object.values(pattern.hashtagSets)) {
    allTags.push(...tags);
  }
  for (const tag of topHashtags.slice(0, 5)) {
    const formatted = tag.startsWith('#') ? tag : `#${tag}`;
    if (!allTags.includes(formatted)) allTags.push(formatted);
  }
  parts.push('\n\n' + allTags.slice(0, rules.idealHashtags).join(' '));

  return parts.join(' ').trim();
}

// ─── Platform-Specific Variants ────────────────────────────────────────────

export function generatePlatformVariants(
  baseCaption: string,
  features: CaptionFeatures,
  category: string,
): { platform: 'instagram' | 'twitter' | 'facebook'; caption: string; hashtags: string[]; scorePrediction: number; reasoning: string }[] {
  const rules = getCategoryRule(category);
  const pattern = PATTERNS[category] || PATTERNS.general;
  const hashtags = (baseCaption.match(/#\w+/g) || []);
  const textOnly = baseCaption.replace(/#\w+/g, '').replace(/\n{2,}/g, '\n').trim();

  // Build dynamic reasoning based on actual features
  const instagramReasons: string[] = [];
  if (features.hashtagCount >= 8) instagramReasons.push('strong hashtag count');
  else if (features.hashtagCount >= 5) instagramReasons.push('moderate hashtags (could use more)');
  else instagramReasons.push('low hashtags, add more for reach');
  if (features.hasCta) instagramReasons.push('clear CTA');
  else instagramReasons.push('missing CTA, add one for conversions');
  if (features.hasPrice) instagramReasons.push('price shown');
  else instagramReasons.push('no price, consider adding');
  if (features.sentiment.polarity > 0.2) instagramReasons.push('positive tone');
  if (features.emojiCount >= 1) instagramReasons.push('engaging emojis');

  const twitterReasons: string[] = [];
  if (textOnly.length <= 200) twitterReasons.push('concise text fits well');
  else twitterReasons.push('text is long, trimmed for 280 char limit');
  if (features.hasCta) twitterReasons.push('CTA included');
  else twitterReasons.push('needs a strong CTA');
  if (features.sentiment.polarity > 0) twitterReasons.push('positive sentiment helps');

  const facebookReasons: string[] = [];
  if (features.wordCount > 80) facebookReasons.push('good storytelling length');
  else if (features.wordCount > 40) facebookReasons.push('moderate length, could tell more story');
  else facebookReasons.push('too brief, Facebook rewards longer stories');
  if (features.hasCta) facebookReasons.push('CTA present');
  else facebookReasons.push('add a CTA for engagement');
  if (features.sentiment.polarity > 0.2) facebookReasons.push('emotional connection');

  return [
    {
      platform: 'instagram',
      caption: baseCaption,
      hashtags,
      scorePrediction: Math.min(10, 6 + features.hashtagCount * 0.2 + (features.hasCta ? 1 : 0) + (features.hasPrice ? 0.5 : 0) + (features.emojiCount >= 1 ? 0.3 : 0)),
      reasoning: `Instagram: ${instagramReasons.join(', ')}. ${features.hashtagCount >= 8 ? 'Excellent hashtag density for discovery.' : 'Add more hashtags for better reach.'}`,
    },
    {
      platform: 'twitter',
      caption: `${textOnly.slice(0, 220)}... ${hashtags.slice(0, 3).join(' ')}`.trim().slice(0, 280),
      hashtags: hashtags.slice(0, 3),
      scorePrediction: Math.min(10, 5.5 + (features.hasCta ? 1.5 : 0) + (features.sentiment.polarity > 0 ? 0.5 : 0) + (textOnly.length <= 200 ? 0.5 : -0.3)),
      reasoning: `Twitter: ${twitterReasons.join(', ')}. ${textOnly.length <= 200 ? 'Fits perfectly in 280 chars.' : 'Trimmed to fit, keep it punchy.'}`,
    },
    {
      platform: 'facebook',
      caption: textOnly + (hashtags.length > 0 ? '\n\n' + hashtags.slice(0, 5).join(' ') : ''),
      hashtags: hashtags.slice(0, 5),
      scorePrediction: Math.min(10, 6 + (features.wordCount > 80 ? 1 : features.wordCount > 40 ? 0.5 : -0.5) + (features.hasCta ? 1 : 0) + (features.sentiment.polarity > 0.2 ? 0.5 : 0)),
      reasoning: `Facebook: ${facebookReasons.join(', ')}. ${features.wordCount > 80 ? 'Great storytelling length.' : 'Expand your story for more engagement.'}`,
    },
  ];
}
