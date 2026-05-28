"""
trendlens/rag_engine.py
RAG engine using MongoDB data and TF-IDF similarity.
No external LLM APIs.
"""

import logging
import math
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


def text_to_tfidf_vector(text: str) -> Dict[str, float]:
    """Convert text to a simple TF vector."""
    words = re.findall(r'[a-z]{3,}', text.lower())
    if not words:
        return {}
    tf: Dict[str, float] = {}
    for w in words:
        tf[w] = tf.get(w, 0) + 1
    total = len(words)
    for w in tf:
        tf[w] /= total
    return tf


def cosine_similarity_tfidf(vec1: Dict[str, float], vec2: Dict[str, float]) -> float:
    """Compute cosine similarity between two TF vectors."""
    if not vec1 or not vec2:
        return 0.0
    dot = sum(vec1.get(k, 0) * vec2.get(k, 0) for k in set(vec1) & set(vec2))
    norm1 = math.sqrt(sum(v ** 2 for v in vec1.values()))
    norm2 = math.sqrt(sum(v ** 2 for v in vec2.values()))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


class RAGEngine:
    """RAG engine that retrieves similar high-performing posts from MongoDB."""

    def find_similar_posts(
        self,
        caption: str,
        category: str = "",
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Find similar high-performing posts."""
        if not caption.strip():
            return []

        try:
            return self._mongodb_search(caption, category, top_k)
        except Exception as exc:
            logger.warning("MongoDB RAG search failed: %s", exc)
            return self._fallback_search(caption, category, top_k)

    def _mongodb_search(self, caption: str, category: str, limit: int) -> List[Dict[str, Any]]:
        """Search MongoDB for similar posts."""
        from trendlens.database import (
            DatabaseManager,
            GroundTruthRepository,
            PostsRepository,
            EmbeddingsRepository,
        )

        # Check DB connection
        db_mgr = DatabaseManager()
        if not db_mgr.health_check():
            return self._fallback_search(caption, category, limit)

        # Try vector search on embeddings collection
        try:
            emb_repo = EmbeddingsRepository()
            query_embedding = self._caption_to_embedding(caption)
            results = emb_repo.vector_search(
                embedding=query_embedding,
                limit=limit,
                filter={"category": category} if category else None,
            )
            if results:
                return [
                    {
                        "caption": r.get("caption", ""),
                        "engagement_rate": r.get("engagement_rate", 0),
                        "category": r.get("category", ""),
                        "hashtags": r.get("hashtags", []),
                        "has_cta": r.get("has_cta", False),
                        "has_price": r.get("has_price", False),
                        "similarity_score": r.get("score", 0),
                        "source": "mongodb_vector",
                    }
                    for r in results
                ]
        except Exception:
            pass

        # Fallback: TF-IDF similarity
        gt_repo = GroundTruthRepository()
        query: Dict[str, Any] = {}
        if category:
            query["category"] = category

        gt_data = gt_repo.find_many(query, sort=[("engagement_rate", -1)], limit=100)
        if not gt_data:
            posts_repo = PostsRepository()
            gt_data = posts_repo.find_many(query, sort=[("engagement_rate", -1)], limit=100)

        if not gt_data:
            return self._fallback_search(caption, category, limit)

        query_vec = text_to_tfidf_vector(caption)
        scored = []
        for doc in gt_data:
            doc_caption = doc.get("caption", "")
            doc_vec = text_to_tfidf_vector(doc_caption)
            sim = cosine_similarity_tfidf(query_vec, doc_vec)
            scored.append((sim, doc))

        scored.sort(key=lambda x: x[0], reverse=True)
        results = []
        for sim, doc in scored[:limit]:
            if sim > 0.01:
                results.append({
                    "caption": doc.get("caption", ""),
                    "engagement_rate": doc.get("engagement_rate", 0),
                    "category": doc.get("category", ""),
                    "hashtags": doc.get("hashtags", []),
                    "has_cta": doc.get("has_cta", False),
                    "has_price": doc.get("has_price", False),
                    "similarity_score": round(sim, 4),
                    "source": "mongodb_tfidf",
                })
        return results

    def _fallback_search(self, caption: str, category: str, limit: int) -> List[Dict[str, Any]]:
        """Fallback heuristic examples when MongoDB is unavailable."""
        examples = {
            "cake": [
                {"caption": "Beautiful custom wedding cake! DM to order. #CakeKampala #WeddingCake UGX 150,000", "engagement_rate": 0.12, "category": "cake", "hashtags": ["CakeKampala", "WeddingCake"], "has_cta": True, "has_price": True, "similarity_score": 0.5, "source": "heuristic"},
                {"caption": "Fresh chocolate layer cake UGX 85,000. WhatsApp 0700 123456. #ChocolateCake #KampalaBakery", "engagement_rate": 0.09, "category": "cake", "hashtags": ["ChocolateCake", "KampalaBakery"], "has_cta": True, "has_price": True, "similarity_score": 0.4, "source": "heuristic"},
            ],
            "bakery": [
                {"caption": "Fresh bread every morning! Whole wheat UGX 5,000. #FreshBread #KampalaBakery", "engagement_rate": 0.08, "category": "bakery", "hashtags": ["FreshBread", "KampalaBakery"], "has_cta": True, "has_price": True, "similarity_score": 0.45, "source": "heuristic"},
            ],
            "restaurant": [
                {"caption": "Lunch special: Matooke + G-nut sauce + rice UGX 15,000! #LunchSpecial #UgandanFood", "engagement_rate": 0.11, "category": "restaurant", "hashtags": ["LunchSpecial", "UgandanFood"], "has_cta": True, "has_price": True, "similarity_score": 0.5, "source": "heuristic"},
            ],
            "general": [
                {"caption": "Support local! Buy fresh produce directly from Ugandan farmers. #BuyLocal #UgandanFarmers", "engagement_rate": 0.07, "category": "general", "hashtags": ["BuyLocal", "UgandanFarmers"], "has_cta": True, "has_price": False, "similarity_score": 0.35, "source": "heuristic"},
            ],
        }
        cat = category if category in examples else "general"
        return examples.get(cat, [])[:limit]

    def _caption_to_embedding(self, caption: str) -> List[float]:
        """Generate 384-dim embedding from caption text."""
        dim = 384
        words = re.findall(r'[a-z]{3,}', caption.lower())
        embedding = [0.0] * dim
        for word in words:
            hash_val = 0
            for ch in word:
                hash_val = ((hash_val << 5) - hash_val + ord(ch)) | 0
            idx = abs(hash_val) % dim
            embedding[idx] += 1
        embedding[dim - 1] = len(words) / 50
        embedding[dim - 2] = len(re.findall(r'#', caption)) / 15
        embedding[dim - 3] = 1.0 if re.search(r'ugx|ush|\$', caption, re.I) else 0.0
        embedding[dim - 4] = 1.0 if re.search(r'dm|whatsapp|link in bio|order', caption, re.I) else 0.0
        norm = math.sqrt(sum(v * v for v in embedding)) or 1
        return [round(v / norm, 6) for v in embedding]
