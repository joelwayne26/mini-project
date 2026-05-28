/**
 * TrendLens AI v6.0 — Category Rules & Validation
 * Domain-specific rules for Ugandan food business categories.
 */

import { CategoryRule } from './types';

export const CATEGORY_RULES: Record<string, CategoryRule> = {
  cake: {
    idealHashtags: 8,
    minHashtags: 5,
    idealCaptionLength: [80, 200],
    requiredKeywords: ['cake', 'order', 'delivery'],
    priceRequired: true,
    ctaRequired: true,
  },
  bakery: {
    idealHashtags: 7,
    minHashtags: 4,
    idealCaptionLength: [60, 180],
    requiredKeywords: ['bakery', 'fresh', 'bread'],
    priceRequired: true,
    ctaRequired: true,
  },
  restaurant: {
    idealHashtags: 8,
    minHashtags: 5,
    idealCaptionLength: [80, 220],
    requiredKeywords: ['food', 'restaurant', 'menu'],
    priceRequired: false,
    ctaRequired: true,
  },
  general: {
    idealHashtags: 6,
    minHashtags: 3,
    idealCaptionLength: [50, 200],
    requiredKeywords: [],
    priceRequired: false,
    ctaRequired: false,
  },
};

export function getCategoryRule(category: string): CategoryRule {
  return CATEGORY_RULES[category] || CATEGORY_RULES.general;
}

export function classifyCategory(caption: string, ocrText: string = ''): string {
  const combined = `${caption} ${ocrText}`.toLowerCase();
  const categoryKeywords: Record<string, string[]> = {
    cake: ['cake', 'birthday', 'wedding cake', 'cupcake', 'icing', 'fondant', 'bakery'],
    bakery: ['bakery', 'bread', 'pastry', 'croissant', 'loaf', 'dough', 'flour'],
    restaurant: ['restaurant', 'menu', 'dish', 'meal', 'food', 'kitchen', 'chef', 'dining'],
  };
  const scores: Record<string, number> = {};
  for (const [cat, keywords] of Object.entries(categoryKeywords)) {
    scores[cat] = keywords.filter(kw => combined.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 2 ? best[0] : 'general';
}
