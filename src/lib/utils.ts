// TrendLens AI v6.0 Utility Functions

import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(num % 1 === 0 ? 0 : 1);
}

export function formatPercent(value: number, decimals = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 7) return formatDate(d);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function getScoreColor(score: number): string {
  if (score >= 0.8) return 'text-emerald-500';
  if (score >= 0.6) return 'text-yellow-500';
  if (score >= 0.4) return 'text-orange-500';
  return 'text-red-500';
}

export function getScoreBgColor(score: number): string {
  if (score >= 0.8) return 'bg-emerald-500';
  if (score >= 0.6) return 'bg-yellow-500';
  if (score >= 0.4) return 'bg-orange-500';
  return 'bg-red-500';
}

export function getScoreLabel(score: number): string {
  if (score >= 0.8) return 'Excellent';
  if (score >= 0.6) return 'Good';
  if (score >= 0.4) return 'Average';
  if (score >= 0.2) return 'Below Average';
  return 'Poor';
}

export function getCategoryEmoji(category: string): string {
  const emojis: Record<string, string> = {
    cake: '\uD83C\uDF82',
    rolex: '\uD83C\uDF2E',
    matooke: '\uD83C\uDF3E',
    grilled_meat: '\uD83C\uDF56',
    local_restaurant: '\uD83C\uDF7D\uFE0F',
    coffee: '\u2615',
    fresh_juice: '\uD83E\uDD64',
    bakery: '\uD83E\uDD50',
    street_food: '\uD83C\uDF2F',
    catering: '\uD83C\uDF7C',
  };
  return emojis[category] || '\uD83C\uDF7D\uFE0F';
}

export function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    cake: 'Cake & Pastry',
    rolex: 'Rolex (Chapati + Eggs)',
    matooke: 'Matooke / Traditional',
    grilled_meat: 'Grilled Meat / BBQ',
    local_restaurant: 'Local Restaurant',
    coffee: 'Coffee & Beverages',
    fresh_juice: 'Fresh Juice & Smoothies',
    bakery: 'Bakery & Bread',
    street_food: 'Street Food',
    catering: 'Catering Services',
  };
  return labels[category] || category;
}

export function getPlatformLabel(platform: string): string {
  const labels: Record<string, string> = {
    instagram: 'Instagram',
    twitter: 'Twitter / X',
    facebook: 'Facebook',
  };
  return labels[platform] || platform;
}

export function getPlatformIcon(platform: string): string {
  const icons: Record<string, string> = {
    instagram: 'Instagram',
    twitter: 'Twitter',
    facebook: 'Facebook',
  };
  return icons[platform] || platform;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\w]+/g);
  return matches ? [...new Set(matches)] : [];
}

export function extractMentions(caption: string): string[] {
  const matches = caption.match(/@[\w]+/g);
  return matches ? [...new Set(matches)] : [];
}

export function countEmojis(text: string): number {
  const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu;
  const matches = text.match(emojiRegex);
  return matches ? matches.length : 0;
}

export function hasCTA(caption: string): boolean {
  const ctaPatterns = [
    /\b(dm|direct message|message me)\b/i,
    /\b(whatsapp|call|phone)\b/i,
    /\b(order|buy|purchase|get yours)\b/i,
    /\b(link in bio|bio link|check bio)\b/i,
    /\b(visit us|come try|come over)\b/i,
    /\b(ugx|shs|price|discount|offer)\b/i,
    /\b(book|reserve|pre.?order)\b/i,
    /\b(limited|hurry|don.?t miss|act now)\b/i,
    /\b(0700|0770|0780|0750|0740)\b/, // Ugandan phone prefixes
  ];
  return ctaPatterns.some((pattern) => pattern.test(caption));
}

export function hasPrice(caption: string): boolean {
  const pricePatterns = [
    /\bugx\b/i,
    /\bshs\b/i,
    /ugx\s?\d/i,
    /shs\s?\d/i,
    /\d+k\b/,
    /price/i,
    /only\s+\d/i,
    /\d{4,}\s*(ugx|shs)/i,
  ];
  return pricePatterns.some((pattern) => pattern.test(caption));
}

export function hasLocation(caption: string): boolean {
  const locationPatterns = [
    /\bkampala\b/i,
    /\bentebbe\b/i,
    /\bmbarara\b/i,
    /\bgulu\b/i,
    /\bjinja\b/i,
    /\bmukono\b/i,
    /\bwakiso\b/i,
    /\bnajjera\b/i,
    /\bnaalya\b/i,
    /\bkira\b/i,
    /\bntinda\b/i,
    /\bkololo\b/i,
    /\bmuyenga\b/i,
    /\bbukoto\b/i,
    /\bkisementi\b/i,
    /\bakamwese\b/i,
    /\blocation/i,
    /\bfind us/i,
    /\bwe are (at|on|in)/i,
  ];
  return locationPatterns.some((pattern) => pattern.test(caption));
}

export function computeReadability(text: string): number {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const avgSentenceLength = words.length / Math.max(text.split(/[.!?]+/).filter(Boolean).length, 1);
  // Simplified Flesch-like score: shorter words and sentences = more readable
  const score = 1 - clamp((avgWordLength - 4) / 8 + (avgSentenceLength - 10) / 30, 0, 1);
  return clamp(score, 0, 1);
}

export function computeSentiment(text: string): number {
  const positiveWords = [
    'delicious', 'amazing', 'best', 'fresh', 'love', 'yummy', 'incredible',
    'tasty', 'mouthwatering', 'perfect', 'awesome', 'fantastic', 'great',
    'wonderful', 'special', 'premium', 'authentic', 'homemade', 'organic',
    'healthy', 'quality', 'exclusive', 'limited', 'hot', 'crispy', 'juicy',
  ];
  const negativeWords = [
    'bad', 'terrible', 'awful', 'disgusting', 'poor', 'worst', 'cold',
    'bland', 'stale', 'overpriced', 'slow', 'disappointed', 'burnt',
  ];

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);

  let score = 0;
  for (const word of words) {
    const clean = word.replace(/[^a-z]/g, '');
    if (positiveWords.includes(clean)) score += 1;
    if (negativeWords.includes(clean)) score -= 1;
  }

  return clamp((score / Math.max(words.length, 1)) * 5 + 0.5, 0, 1);
}
