/**
 * POST /api/pipeline/setup-vector-index — Auto-create Atlas Vector Search Index
 * 
 * Creates the required Atlas Vector Search index for RAG functionality.
 * If the index already exists, returns its status.
 * Falls back to creating a text index for basic search if vector index
 * creation is not available.
 */

import { NextResponse } from 'next/server';
import { getDb, healthCheck } from '@/lib/db/client';

export async function POST() {
  try {
    const connected = await healthCheck();
    if (!connected) {
      return NextResponse.json({
        success: false,
        message: 'MongoDB not connected',
        vectorIndexReady: false,
        fallbackActive: false,
      });
    }

    const db = await getDb();

    // 1. Try to create Atlas Vector Search index via createSearchIndex command
    try {
      const result = await db.command({
        createSearchIndex: 'embeddings',
        name: 'vector_index',
        type: 'vectorSearch',
        definition: {
          mappings: {
            dynamic: false,
            fields: {
              embedding: {
                type: 'vector',
                dimensions: 384,
                similarity: 'cosine',
              },
              category: {
                type: 'filter',
              },
              engagement_rate: {
                type: 'filter',
              },
            },
          },
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Atlas Vector Search index created successfully',
        vectorIndexReady: true,
        fallbackActive: false,
        details: result,
      });
    } catch (vectorError: any) {
      const errMsg = String(vectorError?.message || vectorError);

      // 2. Fallback: Create a text index for basic search
      try {
        await db.collection('embeddings').createIndex({
          caption: 'text',
          category: 1,
        }, {
          name: 'caption_text_search',
          weights: { caption: 10 },
        });

        await db.collection('embeddings').createIndex({
          category: 1,
          engagement_rate: -1,
        }, {
          name: 'category_engagement_compound',
        });

        await db.collection('embeddings').createIndex({
          'has_cta': 1,
          'has_price': 1,
          category: 1,
        }, {
          name: 'cta_price_category_compound',
        });

        return NextResponse.json({
          success: true,
          message: 'Vector index not available — text search fallback created successfully. For full vector search, create the index in Atlas UI.',
          vectorIndexReady: false,
          fallbackActive: true,
          fallbackType: 'text_search + compound_indexes',
          vectorError: errMsg,
          atlasInstructions: {
            indexName: 'vector_index',
            type: 'vectorSearch',
            path: 'embedding',
            dimensions: 384,
            similarity: 'cosine',
          },
        });
      } catch (textIndexError: any) {
        return NextResponse.json({
          success: false,
          message: 'Could not create vector or text index',
          vectorIndexReady: false,
          fallbackActive: false,
          vectorError: errMsg,
          textError: String(textIndexError?.message || textIndexError),
        });
      }
    }
  } catch (error) {
    return NextResponse.json(
      { success: false, message: String(error), vectorIndexReady: false, fallbackActive: false },
      { status: 500 }
    );
  }
}

/** GET — Check vector index status */
export async function GET() {
  try {
    const connected = await healthCheck();
    if (!connected) {
      return NextResponse.json({
        vectorIndexReady: false,
        fallbackActive: false,
        dbConnected: false,
      });
    }

    const db = await getDb();

    const indexes = await db.collection('embeddings').indexes();
    const hasVectorIndex = indexes.some(idx => idx.name === 'vector_index');
    const hasTextIndex = indexes.some(idx => idx.name === 'caption_text_search');

    return NextResponse.json({
      vectorIndexReady: hasVectorIndex,
      fallbackActive: hasTextIndex && !hasVectorIndex,
      dbConnected: true,
      indexes: indexes.map(idx => idx.name),
    });
  } catch (error) {
    return NextResponse.json({
      vectorIndexReady: false,
      fallbackActive: false,
      dbConnected: false,
      error: String(error),
    });
  }
}
