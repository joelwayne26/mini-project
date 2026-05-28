"""
trendlens/caption_generator.py
Template-based NLG caption generator — no external LLM APIs.
"""

import re
from typing import Any, Dict, List, Optional

CAPTION_TEMPLATES: Dict[str, List[str]] = {
    "cake": [
        "Beautiful {product} now available! {price} DM to order yours today. {hashtags}",
        "Fresh from the oven! {product} — {price}. WhatsApp {contact} to order. {hashtags}",
        "Our signature {product} is perfect for any celebration. {price} Link in bio! {hashtags}",
    ],
    "bakery": [
        "Fresh {product} every morning! {price} Come grab yours! {hashtags}",
        "{product} just out of the oven! {price} DM to reserve yours. {hashtags}",
        "Artisan {product} now available! {price} Limited stock daily. {hashtags}",
    ],
    "restaurant": [
        "Lunch special: {product} {price}! Dine-in or takeaway. {hashtags}",
        "Our {product} is voted best in Kampala! {price} {hashtags}",
        "Traditional {product} prepared the Ugandan way! {price} {hashtags}",
    ],
    "general": [
        "Support local! {product} {price} {hashtags}",
        "{product} — quality you can taste! {price} DM to order. {hashtags}",
        "Fresh {product} available now! {price} WhatsApp {contact} {hashtags}",
    ],
}

DEFAULT_HASHTAGS: Dict[str, List[str]] = {
    "cake": ["CakeKampala", "UgandanBakery", "WeddingCake", "CustomCakes", "KampalaEats"],
    "bakery": ["FreshBread", "KampalaBakery", "MorningFresh", "UgandanSnacks", "KampalaEats"],
    "restaurant": ["LunchSpecial", "UgandanFood", "KampalaRestaurant", "KampalaEats", "Foodie"],
    "general": ["BuyLocal", "UgandanFarmers", "SupportLocal", "KampalaEats", "Uganda"],
}

PRODUCT_KEYWORDS: Dict[str, List[str]] = {
    "cake": ["custom cake", "wedding cake", "birthday cake", "red velvet cake", "chocolate cake"],
    "bakery": ["bread", "pastries", "samosa", "mandazi", "chapati", "doughnuts"],
    "restaurant": ["Matooke + G-nut sauce", "Rolex", "grilled tilapia", "Luweero chicken"],
    "general": ["fresh produce", "local food", "coffee", "organic snacks"],
}

PRICE_RANGES: Dict[str, List[str]] = {
    "cake": ["UGX 85,000", "UGX 120,000", "UGX 150,000"],
    "bakery": ["UGX 5,000", "UGX 8,000", "UGX 12,000"],
    "restaurant": ["UGX 15,000", "UGX 20,000", "UGX 25,000"],
    "general": ["UGX 10,000", "UGX 15,000", "UGX 25,000"],
}

CONTACT_TEMPLATES = ["0700 123456", "0772 987654", "0312 456789"]


class CaptionGenerator:
    """Template-based NLG caption generator."""

    def generate(
        self,
        original_caption: str,
        caption_features: Dict[str, Any],
        category: str,
        ocr_meta: Dict[str, Any] = None,
        benchmarks: Dict[str, Any] = None,
    ) -> str:
        """Generate an improved caption using template-based NLG."""
        cat = category if category in CAPTION_TEMPLATES else "general"

        existing_hashtags = re.findall(r'#(\w+)', original_caption)
        existing_price = self._extract_price(original_caption)
        existing_cta = self._extract_cta(original_caption)
        existing_product = self._extract_product(original_caption, cat)

        product = existing_product or self._pick_product(cat)
        price = existing_price
        if not price and ocr_meta and isinstance(ocr_meta, dict):
            ocr_text = ocr_meta.get("full_text", "")
            price = self._extract_price(ocr_text)
        if not price:
            price = self._pick_price(cat, benchmarks)

        recommended = DEFAULT_HASHTAGS.get(cat, DEFAULT_HASHTAGS["general"])
        if benchmarks and benchmarks.get("hashtag_performance"):
            top_db_tags = list(benchmarks["hashtag_performance"].keys())[:5]
            recommended = list(dict.fromkeys(top_db_tags + recommended))[:8]

        all_hashtags = list(dict.fromkeys(existing_hashtags + recommended))[:10]
        hashtag_str = " ".join(f"#{tag}" for tag in all_hashtags)
        cta = existing_cta or "DM to order"
        contact = CONTACT_TEMPLATES[0]

        templates = CAPTION_TEMPLATES[cat]
        template = templates[hash(original_caption) % len(templates)]

        improved = template.format(
            product=product,
            price=f"Starting at {price}" if price else "",
            hashtags=hashtag_str,
            contact=contact,
        )
        improved = re.sub(r'\s+', ' ', improved).strip()

        if cta and cta.lower() not in improved.lower():
            improved = f"{improved} {cta}."

        return improved

    def _extract_price(self, text: str) -> str:
        match = re.search(r'(UGX|USH|USh)\s*[\d,]+', text, re.I)
        if match:
            return match.group(0)
        match = re.search(r'\$\s*[\d,]+', text)
        if match:
            return match.group(0)
        return ""

    def _extract_cta(self, text: str) -> str:
        for pattern in [r'(DM\s+(?:to|us)\s+\w+)', r'(WhatsApp\s+[\d\s]+)', r'(Link\s+in\s+bio)', r'(Order\s+now)', r'(Call\s+[\d\s]+)']:
            match = re.search(pattern, text, re.I)
            if match:
                return match.group(0)
        return ""

    def _extract_product(self, text: str, category: str) -> str:
        products = PRODUCT_KEYWORDS.get(category, PRODUCT_KEYWORDS["general"])
        text_lower = text.lower()
        for product in products:
            if product.lower() in text_lower:
                return product
        return ""

    def _pick_product(self, category: str) -> str:
        products = PRODUCT_KEYWORDS.get(category, PRODUCT_KEYWORDS["general"])
        return products[0] if products else "our products"

    def _pick_price(self, category: str, benchmarks: Dict[str, Any] = None) -> str:
        prices = PRICE_RANGES.get(category, PRICE_RANGES["general"])
        return prices[len(prices) // 2] if prices else "UGX 15,000"
