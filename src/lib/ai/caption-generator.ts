/**
 * TrendLens AI v6.0 — Local Caption Generator
 * Template-based NLG with intelligent composition — NO external LLM APIs.
 * Generates creative, contextually-aware captions for Ugandan food businesses.
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
      'Limited slots available — book yours now!',
    ],
    hashtagSets: {
      core: ['#CakeKampala', '#UgandanBakery', '#CustomCakesUG', '#CakeLover'],
      type: ['#WeddingCake', '#BirthdayCake', '#Cupcakes', '# FondantCake'],
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
      'Reserve your table — DM or call!',
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
      'Limited stock — order now!',
    ],
    hashtagSets: {
      core: ['#KampalaBusiness', '#SupportLocalUG', '#Uganda', '#MadeInUG'],
      type: ['#Quality', '#SmallBusiness', '#LocalFirst', '#ShopLocal'],
      local: ['#Kampala', '#UgandaLife', '#UGBusiness', '#KlaHustle'],
    },
    emojiSets: ['✨🔥💯', '💪🇺🇬❤️', '🎯⭐💫', '🚀💯❤️'],
  },
};

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

export function generateImprovedCaption(
  originalCaption: string,
  features: CaptionFeatures,
  category: string,
  trendKeywords: string[] = [],
  topHashtags: string[] = [],
): string {
  if (!originalCaption.trim()) {
    return generateCaptionFromScratch(category, trendKeywords, topHashtags);
  }

  const rules = getCategoryRule(category);
  const pattern = PATTERNS[category] || PATTERNS.general;
  const item = detectItemFromCaption(originalCaption, category);
  const parts: string[] = [];

  // 1. Opening hook
  const needsHook = originalCaption.length < 50 || !originalCaption.match(/^[A-Z]/);
  if (needsHook) {
    parts.push(pick(pattern.openings) + ' ' + pick(pattern.descriptions).replace('{item}', item) + '!');
  } else {
    // Polish the original opening
    parts.push(originalCaption.split(/[.!]/)[0].trim());
  }

  // 2. Price mention
  if (!features.hasPrice && rules.priceRequired) {
    const pricePhrases = ['Starting at UGX 50,000', 'Prices from UGX 30,000', 'Affordable luxury from UGX 25,000'];
    parts.push(pick(pricePhrases));
  }

  // 3. Benefit / value proposition
  if (features.wordCount < 60) {
    parts.push(pick(pattern.benefits));
  }

  // 4. Trend keyword injection
  if (trendKeywords.length > 0 && features.trendAlignment.score < 0.3) {
    const trendingPhrase = `Trending now: ${trendKeywords.slice(0, 2).join(' & ')}`;
    parts.push(trendingPhrase);
  }

  // 5. CTA
  if (!features.hasCta) {
    parts.push(pick(pattern.ctas));
  }

  // 6. Emojis
  const hasEmojis = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(originalCaption);
  if (!hasEmojis) {
    parts.push(pick(pattern.emojiSets));
  }

  // 7. Hashtags
  const existingHashtags = (originalCaption.match(/#\w+/g) || []).map(h => h.toLowerCase());
  const neededCount = Math.max(0, rules.idealHashtags - existingHashtags.length);
  const newHashtags: string[] = [];

  // Add category-specific hashtags
  for (const [_, tags] of Object.entries(pattern.hashtagSets)) {
    for (const tag of tags) {
      if (newHashtags.length >= neededCount) break;
      if (!existingHashtags.includes(tag.toLowerCase()) && !newHashtags.includes(tag)) {
        newHashtags.push(tag);
      }
    }
  }

  // Add top-performing hashtags from DB
  for (const tag of topHashtags.slice(0, 5)) {
    if (newHashtags.length >= neededCount) break;
    const formatted = tag.startsWith('#') ? tag : `#${tag}`;
    if (!existingHashtags.includes(formatted.toLowerCase()) && !newHashtags.includes(formatted)) {
      newHashtags.push(formatted);
    }
  }

  if (newHashtags.length > 0) {
    parts.push('\n\n' + newHashtags.join(' '));
  }

  // Preserve existing hashtags from original
  if (existingHashtags.length > 0) {
    parts.push(existingHashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' '));
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

  // Trend
  if (trendKeywords.length > 0) {
    parts.push(`Join the ${trendKeywords[0]} trend!`);
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

  return [
    {
      platform: 'instagram',
      caption: baseCaption, // Full caption with all hashtags
      hashtags,
      scorePrediction: Math.min(10, 6 + features.hashtagCount * 0.2 + (features.hasCta ? 1 : 0) + (features.hasPrice ? 0.5 : 0)),
      reasoning: 'Instagram favors longer captions with 8+ hashtags, CTA, and price mentions for maximum discoverability and conversion',
    },
    {
      platform: 'twitter',
      caption: `${textOnly.slice(0, 220)}... ${hashtags.slice(0, 3).join(' ')}`.trim().slice(0, 280),
      hashtags: hashtags.slice(0, 3),
      scorePrediction: Math.min(10, 5.5 + (features.hasCta ? 1.5 : 0) + (features.sentiment.polarity > 0 ? 0.5 : 0)),
      reasoning: 'Twitter rewards brevity — concise text with 2-3 strategic hashtags and strong CTA drives the most engagement',
    },
    {
      platform: 'facebook',
      caption: textOnly + (hashtags.length > 0 ? '\n\n' + hashtags.slice(0, 5).join(' ') : ''),
      hashtags: hashtags.slice(0, 5),
      scorePrediction: Math.min(10, 6 + (features.wordCount > 80 ? 1 : 0) + (features.hasCta ? 1 : 0) + (features.sentiment.polarity > 0 ? 0.5 : 0)),
      reasoning: 'Facebook values storytelling — longer, personal captions with moderate hashtags and emotional connection perform best',
    },
  ];
}
