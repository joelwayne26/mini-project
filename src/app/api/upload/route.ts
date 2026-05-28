/**
 * POST /api/upload — Poster Image Upload & Analysis
 * Accepts base64 image data, analyzes quality with Sharp,
 * returns ImageQualityMetrics for use in evaluation.
 * Vercel-compatible: no temp files, all in-memory.
 */

import { NextRequest, NextResponse } from 'next/server';
import { analyzeImageQuality, generateImageImprovementSuggestions } from '@/lib/ai/server-image-analysis';
import { config } from '@/lib/config';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    let imageBase64: string;
    let fileName = 'poster';

    if (contentType.includes('multipart/form-data')) {
      // Handle multipart form data
      const formData = await request.formData();
      const file = formData.get('image') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No image file provided. Use field name "image"' }, { status: 400 });
      }
      fileName = file.name;
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Check size
      const sizeMB = buffer.length / (1024 * 1024);
      if (sizeMB > config.maxImageSizeMB) {
        return NextResponse.json(
          { error: `Image too large (${sizeMB.toFixed(1)}MB). Max is ${config.maxImageSizeMB}MB` },
          { status: 400 }
        );
      }

      imageBase64 = buffer.toString('base64');
    } else {
      // Handle JSON with base64
      const body = await request.json();
      imageBase64 = body.imageBase64 || body.image_base64 || '';
      if (!imageBase64) {
        return NextResponse.json({ error: 'Provide imageBase64 in JSON body or upload multipart form with "image" field' }, { status: 400 });
      }

      // Estimate size from base64 length
      const sizeBytes = Math.ceil(imageBase64.length * 0.75);
      const sizeMB = sizeBytes / (1024 * 1024);
      if (sizeMB > config.maxImageSizeMB) {
        return NextResponse.json(
          { error: `Image too large (${sizeMB.toFixed(1)}MB). Max is ${config.maxImageSizeMB}MB` },
          { status: 400 }
        );
      }
    }

    // Analyze image quality with Sharp
    const imageQuality = await analyzeImageQuality(imageBase64);
    const improvementSuggestions = generateImageImprovementSuggestions(imageQuality);

    // Generate a small thumbnail for preview (max 200px wide)
    let thumbnailBase64 = '';
    try {
      const rawBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const thumbnailBuffer = await sharp(Buffer.from(rawBase64, 'base64'))
        .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70 })
        .toBuffer();
      thumbnailBase64 = `data:image/jpeg;base64,${thumbnailBuffer.toString('base64')}`;
    } catch {
      // Thumbnail generation is non-critical
    }

    return NextResponse.json({
      success: true,
      fileName,
      imageQuality,
      improvementSuggestions,
      thumbnailBase64,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Image upload/analysis failed:', error);
    return NextResponse.json(
      { error: 'Image analysis failed', detail: String(error) },
      { status: 500 }
    );
  }
}

// Import sharp for thumbnail generation
import sharp from 'sharp';
