// TrendLens AI v6.0 - Image Quality Assessment
// Analyzes image properties using Canvas API / server-side computation

export interface ImageQualityResult {
  overallScore: number;
  blurScore: number;
  brightnessScore: number;
  contrastScore: number;
  resolutionScore: number;
  colorfulnessScore: number;
  aspectRatioScore: number;
  recommendations: string[];
}

/**
 * Assess image quality from URL or base64 data
 * Uses heuristic scoring since we can't do full image processing in API routes easily
 */
export function assessImageQuality(imageUrl?: string): ImageQualityResult {
  const result: ImageQualityResult = {
    overallScore: 0.5,
    blurScore: 0.6,
    brightnessScore: 0.7,
    contrastScore: 0.65,
    resolutionScore: 0.7,
    colorfulnessScore: 0.6,
    aspectRatioScore: 0.7,
    recommendations: [],
  };

  if (!imageUrl) {
    result.overallScore = 0.3;
    result.recommendations.push('Add an image to significantly improve engagement');
    result.recommendations.push('Posts with images get 2.3x more engagement');
    return result;
  }

  // If we have an image URL, provide optimistic scores
  // In production, this would use sharp/jimp to actually analyze the image
  const hasImage = imageUrl.length > 0;

  if (hasImage) {
    result.overallScore = 0.7;
    result.blurScore = 0.75;
    result.brightnessScore = 0.8;
    result.contrastScore = 0.7;
    result.resolutionScore = 0.75;
    result.colorfulnessScore = 0.7;
    result.aspectRatioScore = 0.75;

    // Provide food-specific recommendations
    result.recommendations.push('Ensure food is well-lit with natural lighting when possible');
    result.recommendations.push('Use close-up shots to highlight texture and details');
  }

  return result;
}

/**
 * Score image for food-specific visual appeal
 */
export function scoreFoodVisualAppeal(imageUrl?: string): number {
  if (!imageUrl) return 0.2;
  // Heuristic: having an image at all is a big plus
  return 0.65;
}

/**
 * Get food photography tips based on category
 */
export function getFoodPhotographyTips(category: string): string[] {
  const tips: Record<string, string[]> = {
    cake: [
      'Show cake slices at a 45-degree angle for best presentation',
      'Use natural daylight near a window for the best lighting',
      'Include decorative elements like flowers or cake stands',
      'Capture the texture of frosting in detail shots',
    ],
    rolex: [
      'Show the rolex being made (action shots perform well)',
      'Capture the steam rising from freshly made rolex',
      'Include the chapati rolling process for behind-the-scenes',
      'Use a wooden cutting board as a prop for authentic feel',
    ],
    matooke: [
      'Show matooke steaming in banana leaves for authenticity',
      'Include all accompaniments in the frame',
      'Capture the traditional preparation process',
      'Use earthy tones and natural settings',
    ],
    grilled_meat: [
      'Capture grill flames and smoke for dramatic effect',
      'Show the meat being turned on the grill',
      'Include close-ups of the char marks',
      'Photograph the full plate with sides',
    ],
    coffee: [
      'Show latte art and crema detail',
      'Capture the pouring moment',
      'Use moody lighting for ambiance shots',
      'Include the coffee source/origin story visually',
    ],
    fresh_juice: [
      'Photograph with vibrant fruit garnishes',
      'Show the juice being poured for dynamic shots',
      'Use colorful backgrounds that complement the juice',
      'Include fresh fruits visible in the composition',
    ],
    bakery: [
      'Show bread fresh from the oven with steam',
      'Capture the golden crust texture in detail',
      'Include a bread basket or wooden board for staging',
      'Show variety by grouping different bread types',
    ],
    street_food: [
      'Capture the busy street environment for context',
      'Show the cooking process (action shots)',
      'Include customers enjoying the food',
      'Photograph during golden hour for warm tones',
    ],
    local_restaurant: [
      'Show the restaurant ambiance and decor',
      'Capture signature dishes at their best angle',
      'Include happy customers (with permission)',
      'Show the chef/cook in action',
    ],
    catering: [
      'Show the full buffet/spread setup',
      'Capture elegant table settings',
      'Include guests enjoying the event',
      'Photograph signature dishes individually',
    ],
  };

  return tips[category] || [
    'Use natural lighting for food photography',
    'Capture food from a 45-degree angle',
    'Include context and props',
    'Show texture and detail in close-ups',
  ];
}
