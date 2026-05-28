"""
trendlens/text_processor.py
Enhanced TextProcessor with TF-IDF support, sentiment, keywords, and utility methods.
"""

import logging
import math
import re
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Lazy imports for optional heavy libraries
_textblob = None
_tfidf_vectorizer = None


def _get_textblob():
    global _textblob
    if _textblob is None:
        try:
            from textblob import TextBlob
            _textblob = TextBlob
        except ImportError:
            logger.warning("textblob not installed — sentiment/keyword fallback limited")
            _textblob = False
    return _textblob if _textblob is not False else None


def _get_tfidf():
    global _tfidf_vectorizer
    if _tfidf_vectorizer is None:
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            _tfidf_vectorizer = TfidfVectorizer
        except ImportError:
            logger.warning("sklearn not installed — TF-IDF features disabled")
            _tfidf_vectorizer = False
    return _tfidf_vectorizer if _tfidf_vectorizer is not False else None


class TextProcessor:
    """Enhanced text processor with TF-IDF, sentiment, and caption analysis."""

    # Regex patterns
    HASHTAG_RE = re.compile(r"#(\w+)")
    MENTION_RE = re.compile(r"@(\w+)")
    PRICE_RE = re.compile(r"(?:UGX|ush|USh|ugx)\s?([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s?(?:UGX|ush|USh|ugx)", re.IGNORECASE)
    URL_RE = re.compile(r"https?://\S+")
    EMOJI_RE = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U0001f926-\U0001f937"
        "\U00010000-\U0010ffff"
        "\u2640-\u2642"
        "\u2600-\u2B55"
        "\u200d"
        "\u23cf"
        "\u23e9"
        "\u231a"
        "\ufe0f"
        "\u3030"
        "]+",
        re.UNICODE,
    )

    CTA_WORDS = [
        "order", "dm", "call", "book", "buy", "shop", "visit", "subscribe",
        "follow", "link in bio", "click", "grab", "get yours", "limited",
        "whatsapp", "contact", "deliver", "free delivery", "tap", "check out",
    ]

    STOP_WORDS = frozenset({
        "a", "an", "the", "is", "it", "in", "on", "of", "for", "to", "and",
        "or", "with", "at", "by", "from", "this", "that", "are", "was", "be",
        "have", "has", "had", "but", "not", "they", "we", "you", "i", "my",
        "our", "your", "its", "so", "if", "as", "do", "did", "can", "will",
    })

    def __init__(self) -> None:
        self._tfidf_model: Any = None
        self._tfidf_fitted: bool = False

    # ── Extraction helpers ───────────────────────────────────────────

    def extract_hashtags(self, text: str) -> List[str]:
        """Return list of hashtags (without #)."""
        return self.HASHTAG_RE.findall(text)

    def extract_mentions(self, text: str) -> List[str]:
        """Return list of mentions (without @)."""
        return self.MENTION_RE.findall(text)

    def extract_prices(self, text: str) -> List[str]:
        """Return list of price strings found in text."""
        matches = self.PRICE_RE.findall(text)
        results: List[str] = []
        for group1, group2 in matches:
            price = group1 or group2
            if price:
                results.append(price.replace(",", ""))
        return results

    def count_emojis(self, text: str) -> int:
        """Count emoji characters in text."""
        return len(self.EMOJI_RE.findall(text))

    # ── Analysis helpers ─────────────────────────────────────────────

    def analyze_sentiment(self, text: str) -> Dict[str, float]:
        """Return sentiment polarity and subjectivity."""
        TextBlob = _get_textblob()
        if TextBlob is not None:
            try:
                blob = TextBlob(text)
                return {
                    "polarity": float(blob.sentiment.polarity),
                    "subjectivity": float(blob.sentiment.subjectivity),
                }
            except Exception as exc:
                logger.debug("TextBlob sentiment failed: %s", exc)

        # Fallback: simple lexicon-based polarity
        positive = sum(1 for w in text.lower().split() if w in {"great", "amazing", "love", "best", "delicious", "awesome", "perfect", "wonderful"})
        negative = sum(1 for w in text.lower().split() if w in {"bad", "terrible", "worst", "awful", "disgusting", "hate", "poor"})
        total = max(len(text.split()), 1)
        polarity = (positive - negative) / total
        return {"polarity": polarity, "subjectivity": 0.5}

    def extract_keywords(self, text: str, top_n: int = 10) -> List[str]:
        """Extract keywords using TF-IDF if available, else TextBlob."""
        if self._tfidf_fitted and self._tfidf_model is not None:
            return self.extract_keywords_tfidf(text, top_n)
        return self._extract_keywords_textblob(text, top_n)

    def _extract_keywords_textblob(self, text: str, top_n: int = 10) -> List[str]:
        """Fallback keyword extraction using TextBlob noun phrases."""
        TextBlob = _get_textblob()
        if TextBlob is not None:
            try:
                blob = TextBlob(text)
                phrases = list(blob.noun_phrases)
                return phrases[:top_n]
            except Exception as exc:
                logger.debug("TextBlob noun phrases failed: %s", exc)

        # Simple fallback: remove stop words, sort by frequency
        words = re.findall(r"\b[a-z]{3,}\b", text.lower())
        filtered = [w for w in words if w not in self.STOP_WORDS]
        freq: Dict[str, int] = {}
        for w in filtered:
            freq[w] = freq.get(w, 0) + 1
        sorted_words = sorted(freq, key=freq.get, reverse=True)  # type: ignore[arg-type]
        return sorted_words[:top_n]

    def extract_keywords_tfidf(self, text: str, top_n: int = 10) -> List[str]:
        """Extract keywords using fitted TF-IDF model."""
        if not self._tfidf_fitted or self._tfidf_model is None:
            return self._extract_keywords_textblob(text, top_n)
        try:
            vec = self._tfidf_model.transform([text])
            feature_names = self._tfidf_model.get_feature_names_out()
            scores = vec.toarray()[0]
            top_indices = scores.argsort()[::-1][:top_n]
            return [feature_names[i] for i in top_indices if scores[i] > 0]
        except Exception as exc:
            logger.debug("TF-IDF keyword extraction failed: %s", exc)
            return self._extract_keywords_textblob(text, top_n)

    # ── Caption utilities ────────────────────────────────────────────

    def clean_caption(self, text: str) -> str:
        """Clean and normalize caption text."""
        # Remove URLs
        text = self.URL_RE.sub("", text)
        # Remove extra whitespace
        text = re.sub(r"\s+", " ", text).strip()
        # Normalize common Ugandan shorthand
        text = re.sub(r"\bUgx\b", "UGX", text, flags=re.IGNORECASE)
        return text

    def compute_readability(self, text: str) -> float:
        """Compute a simple readability score (0–1 scale)."""
        sentences = re.split(r"[.!?]+", text)
        sentences = [s.strip() for s in sentences if s.strip()]
        if not sentences:
            return 0.0
        words = text.split()
        word_count = len(words)
        if word_count == 0:
            return 0.0
        avg_sentence_len = word_count / len(sentences)
        # Ideal sentence length ~12-15 words
        score = 1.0 - abs(avg_sentence_len - 14) / 30.0
        return max(0.0, min(1.0, score))

    # ── TF-IDF builder ───────────────────────────────────────────────

    def build_tfidf_from_db(self, corpus: Optional[List[str]] = None) -> bool:
        """Fit a TfidfVectorizer on a corpus (typically from DB).

        Returns True if fitting succeeded.
        """
        TfidfVectorizer = _get_tfidf()
        if TfidfVectorizer is None:
            logger.warning("sklearn TfidfVectorizer unavailable — cannot build TF-IDF model")
            return False

        if not corpus:
            # Attempt to load from database
            try:
                from trendlens.database import get_collection
                coll = get_collection("ground_truth_posts")
                docs = list(coll.find({}, {"caption": 1}))
                corpus = [d.get("caption", "") for d in docs if d.get("caption")]
            except Exception as exc:
                logger.error("Failed to load corpus from DB: %s", exc)
                return False

        if not corpus or len(corpus) < 5:
            logger.warning("Corpus too small for TF-IDF (%d docs)", len(corpus) if corpus else 0)
            return False

        try:
            self._tfidf_model = TfidfVectorizer(
                max_features=5000,
                stop_words="english",
                ngram_range=(1, 2),
                min_df=2,
                max_df=0.9,
            )
            self._tfidf_model.fit(corpus)
            self._tfidf_fitted = True
            logger.info("TF-IDF model fitted on %d documents", len(corpus))
            return True
        except Exception as exc:
            logger.error("TF-IDF fitting failed: %s", exc)
            return False

    def has_tfidf(self) -> bool:
        return self._tfidf_fitted

    # ── CTA detection ────────────────────────────────────────────────

    def detect_cta(self, text: str) -> Dict[str, Any]:
        """Detect call-to-action phrases in text."""
        lower = text.lower()
        found = [cta for cta in self.CTA_WORDS if cta in lower]
        return {
            "has_cta": len(found) > 0,
            "cta_count": len(found),
            "cta_phrases": found,
        }

    def compute_caption_features(self, caption: str) -> Dict[str, Any]:
        """Compute all caption features in one call."""
        cleaned = self.clean_caption(caption)
        hashtags = self.extract_hashtags(caption)
        mentions = self.extract_mentions(caption)
        prices = self.extract_prices(caption)
        emojis = self.count_emojis(caption)
        sentiment = self.analyze_sentiment(cleaned)
        keywords = self.extract_keywords(cleaned)
        readability = self.compute_readability(cleaned)
        cta = self.detect_cta(cleaned)
        word_count = len(cleaned.split())
        char_count = len(cleaned)

        return {
            "original_caption": caption,
            "cleaned_caption": cleaned,
            "word_count": word_count,
            "char_count": char_count,
            "hashtags": hashtags,
            "hashtag_count": len(hashtags),
            "mentions": mentions,
            "mention_count": len(mentions),
            "prices": prices,
            "has_price": len(prices) > 0,
            "emoji_count": emojis,
            "sentiment": sentiment,
            "keywords": keywords,
            "readability": readability,
            "cta": cta,
        }
